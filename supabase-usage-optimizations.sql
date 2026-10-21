-- Run once in Supabase SQL Editor; safe to rerun.
-- Returns the same approved non-video upload counts without transferring URLs.
-- No files, rows, or existing logging settings are changed or deleted.
begin;

create or replace function public.utwx_decode_media_path(value text)
returns text language plpgsql immutable parallel safe set search_path = public as $$
declare source text := coalesce(value,''); result bytea := ''::bytea; i integer := 1;
begin
  if position('%' in source) = 0 or source ~ '%(?![0-9a-fA-F]{2})' then return source; end if;
  while i <= length(source) loop
    if substr(source,i,1) = '%' then
      result := result || decode(substr(source,i+1,2),'hex'); i := i+3;
    else
      result := result || convert_to(substr(source,i,1),'UTF8'); i := i+1;
    end if;
  end loop;
  return convert_from(result,'UTF8');
exception when others then return source;
end; $$;

create or replace function public.approved_upload_counts()
returns jsonb language sql stable security invoker set search_path = public as $$
  with grouped as (
    select tornado_id::text as tornado_id, count(*) as upload_count
    from public.uploads
    where status = 'approved'
      and nullif(tornado_id::text,'') is not null
      and lower(coalesce(category,'')) not in ('video','videos')
      and coalesce(file_url,'') !~* '^data:video/'
      and public.utwx_decode_media_path(regexp_replace(split_part(split_part(btrim(coalesce(file_url,'')),'?',1),'#',1),'^([[:alpha:]][[:alnum:]+.-]*:)?//[^/]*',''))
        !~* '\.(mp4|m4v|mov|webm|ogv|ogg|avi|mpeg|mpg|mkv|3gp|3g2|mts|m2ts|ts)$'
    group by tornado_id
  )
  select jsonb_build_object(
    'counts',coalesce(jsonb_agg(jsonb_build_object('tornado_id',tornado_id,'upload_count',upload_count) order by tornado_id),'[]'::jsonb),
    'total',coalesce(sum(upload_count),0)
  ) from grouped;
$$;

revoke all on function public.utwx_decode_media_path(text) from public;
grant execute on function public.utwx_decode_media_path(text) to anon, authenticated;
revoke all on function public.approved_upload_counts() from public;
grant execute on function public.approved_upload_counts() to anon, authenticated;

commit;
