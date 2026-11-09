Attributes {
    time {
        String units "seconds since 2017-01-01";
        String standard_name "time";
        String long_name "The start date / time that the satellite began capturing the scene";
        String axis "T";
        String calendar "standard";
    }
    x {
        Float64 scale_factor 56.0;
        Float64 add_offset -151844.0;
        String units "microradian";
        String standard_name "projection_x_coordinate";
    }
    y {
        Float64 scale_factor -56.0;
        Float64 add_offset 151844.0;
        String units "microradian";
        String standard_name "projection_y_coordinate";
    }
    fixedgrid_projection {
        Float64 latitude_of_projection_origin 0.0;
        Float64 longitude_of_projection_origin -137.0;
        Float64 perspective_point_height 3.5786023E7;
        Float64 semi_major_axis 6378137.0;
        Float64 semi_minor_axis 6356752.31414;
        String grid_mapping_name "geostationary";
        String sweep_angle_axis "x";
    }
    Sectorized_CMI {
        Int16 _FillValue -1;
        Float32 add_offset 89.62;
        Float32 scale_factor 0.06145332;
        Int16 valid_min 0;
        Int16 valid_max 4095;
        Float32 percent_good_pixel_qf 1.0;
        Float32 percent_conditionally_usable_pixel_qf 0.0;
        Float32 percent_out_of_range_pixel_qf 0.0;
        Float32 percent_no_value_pixel_qf 0.0;
        Float32 percent_focal_plane_temperature_threshold_exceeded_qf 0.0;
        Float32 maximum_focal_plane_temperature 0.0;
        String standard_name "brightness_temperature";
        String units "kelvin";
        String grid_mapping "fixedgrid_projection";
        String coordinates "time y x";
        UInt32 _ChunkSizes 1356, 1812;
    }
    NC_GLOBAL {
        Int32 abi_mode 6;
        Float32 central_wavelength 10.35;
        Float32 periodicity 10.0;
        Int32 channel_id 13;
        Int32 product_tile_width 1812;
        Int32 product_tile_height 1356;
        Int32 product_rows 2712;
        Int32 product_columns 5424;
        Float64 product_center_latitude 25.92130276372714;
        Float64 product_center_longitude -137.0;
        Float64 pixel_x_size 2.0;
        Float64 pixel_y_size 2.0;
        Float32 source_spatial_resolution 2.0;
        Float32 request_spatial_resolution 2.0;
        Int32 bit_depth 12;
        Int32 number_product_tiles 6;
        Float64 satellite_latitude 0.0;
        Float64 satellite_longitude -137.0;
        Float64 satellite_altitude 3.5786023E7;
        String Conventions "CF-1.6";
        String ICD_version "GROUND SEGMENT (GS) TO ADVANCED WEATHER INTERACTIVE PROCESSING SYSTEM (AWIPS) INTERFACE CONTROL DOCUMENT (ICD) Revision B";
        String source_scene "FullDisk";
        String title "Sectorized Cloud and Moisture Imagery for the WFDM6 region.";
        String production_location "GCCS";
        String satellite_id "GOES-18";
        String product_name "WFD-020-B12-M6C13";
        String projection "Fixed Grid";
        String start_date_time "2026313005022";
        String production_cluster "L1 Green";
        Int32 product_tiles_received 6;
    }
}
