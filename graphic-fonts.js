export const GRAPHIC_FONT_CATALOG = Object.freeze([
  {
    "key": "cmu",
    "label": "CMU Serif",
    "family": "\"CMU Classical Serif\", \"CMU Serif\", \"Computer Modern\", Georgia, serif"
  },
  {
    "key": "barlowCondensed",
    "label": "Barlow Condensed",
    "family": "\"Barlow Condensed\", \"Roboto Condensed\", \"Oswald\", Impact, \"Arial Narrow\", sans-serif"
  },
  {
    "key": "bebasNeue",
    "label": "Bebas Neue",
    "family": "\"Bebas Neue\", \"Barlow Condensed\", Impact, \"Arial Narrow\", sans-serif"
  },
  {
    "key": "cormorantGaramond",
    "label": "Cormorant Garamond",
    "family": "\"Cormorant Garamond\", Georgia, \"Times New Roman\", serif"
  },
  {
    "key": "caveat",
    "label": "Caveat Handwriting",
    "family": "\"Caveat\", \"Kalam\", \"Segoe Print\", cursive"
  },
  {
    "key": "merienda",
    "label": "Merienda Elegant",
    "family": "\"Merienda\", \"Caveat\", Georgia, serif"
  },
  {
    "key": "playpenSans",
    "label": "Playpen Sans Handwriting",
    "family": "\"Playpen Sans\", \"Kalam\", \"Segoe Print\", cursive"
  },
  {
    "key": "handlee",
    "label": "Handlee Handwriting",
    "family": "\"Handlee\", \"Kalam\", \"Segoe Print\", cursive"
  },
  {
    "key": "kalam",
    "label": "Kalam Handwriting",
    "family": "\"Kalam\", \"Comic Sans MS\", \"Segoe Print\", cursive"
  },
  {
    "key": "signproject",
    "label": "Sign Project Oblique JNL",
    "family": "\"Sign Project Oblique JNL\", \"Sign Project JNL\", \"Arial Narrow\", \"Trebuchet MS\", sans-serif"
  },
  {
    "key": "efScript",
    "label": "EF Handwritten Script",
    "family": "\"Nothing You Could Do\", \"Segoe Script\", \"Bradley Hand ITC\", cursive"
  },
  {
    "key": "top100Title",
    "label": "Top 100 Bold Italic",
    "family": "\"Barlow Condensed\", \"Roboto Condensed\", \"Oswald\", Impact, \"Arial Narrow Bold\", sans-serif"
  },
  {
    "key": "inter",
    "label": "Inter",
    "family": "\"Inter\", Arial, sans-serif"
  },
  {
    "key": "montserrat",
    "label": "Montserrat",
    "family": "\"Montserrat\", \"Inter\", Arial, sans-serif"
  },
  {
    "key": "robotoCondensed",
    "label": "Roboto Condensed",
    "family": "\"Roboto Condensed\", \"Arial Narrow\", Arial, sans-serif"
  },
  {
    "key": "oswald",
    "label": "Oswald",
    "family": "\"Oswald\", \"Arial Narrow\", Arial, sans-serif"
  },
  {
    "key": "system",
    "label": "System Clean",
    "family": "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
  },
  {
    "key": "helvetica",
    "label": "Helvetica Neue",
    "family": "\"Helvetica Neue\", Helvetica, Arial, sans-serif"
  },
  {
    "key": "segoe",
    "label": "Segoe UI",
    "family": "\"Segoe UI\", Tahoma, Geneva, sans-serif"
  },
  {
    "key": "avenir",
    "label": "Avenir",
    "family": "Avenir, \"Avenir Next\", \"Helvetica Neue\", Arial, sans-serif"
  },
  {
    "key": "futura",
    "label": "Futura",
    "family": "Futura, \"Trebuchet MS\", Arial, sans-serif"
  },
  {
    "key": "trebuchet",
    "label": "Trebuchet MS",
    "family": "\"Trebuchet MS\", \"Segoe UI\", Arial, sans-serif"
  },
  {
    "key": "verdana",
    "label": "Verdana",
    "family": "Verdana, Geneva, sans-serif"
  },
  {
    "key": "georgia",
    "label": "Georgia",
    "family": "Georgia, \"Times New Roman\", serif"
  },
  {
    "key": "times",
    "label": "Times New Roman",
    "family": "\"Times New Roman\", Times, serif"
  },
  {
    "key": "arial",
    "label": "Arial",
    "family": "Arial, Helvetica, sans-serif"
  },
  {
    "key": "impact",
    "label": "Impact",
    "family": "Impact, Haettenschweiler, \"Arial Narrow Bold\", sans-serif"
  },
  {
    "key": "palatino",
    "label": "Palatino · Classical",
    "family": "\"Palatino Linotype\", \"Book Antiqua\", Palatino, \"Times New Roman\", serif"
  }
]);
export const GRAPHIC_FONTS = Object.freeze(Object.fromEntries(GRAPHIC_FONT_CATALOG.map(font=>[font.key,font.family])));
const aliases={serif:'georgia',roboto:'robotoCondensed'};
export const canonicalGraphicFont=key=>aliases[key]||key;
const familyKeys=new Map(GRAPHIC_FONT_CATALOG.map(font=>[font.family,font.key]));
// These options have a specific face in the tornado generator as well.
export function graphicCanvasFont(familyOrKey,size,requested='700') {
  const key=canonicalGraphicFont(familyOrKey),family=GRAPHIC_FONTS[key]||familyOrKey;
  const resolved=GRAPHIC_FONTS[key]?key:familyKeys.get(family);
  let face=String(requested),weight=Number(face.match(/\d{3}/)?.[0]||700),italic=/italic|oblique/.test(face)?'italic ':'';
  if(resolved==='top100Title')face='italic 900';
  else if(resolved==='signproject')face='oblique 400';
  else if(['handlee','efScript','bebasNeue'].includes(resolved))face='400';
  else if(['caveat','cormorantGaramond','oswald'].includes(resolved))face=italic+Math.max(resolved==='cormorantGaramond'?500:400,Math.min(700,weight));
  else if(resolved==='playpenSans')face=String(Math.max(400,Math.min(800,weight)));
  else if(resolved==='merienda')face=String(Math.max(400,Math.min(900,weight)));
  else if(resolved==='kalam')face=String(weight>=600?700:400);
  return `${face} ${size}px ${family}`;
}
export function graphicFontRequests(key) {
  return [...new Set(['400','500','600','700','800','900','italic 900'].map(face=>graphicCanvasFont(key,32,face)))];
}
