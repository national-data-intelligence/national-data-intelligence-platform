/*
    hub_hcmis_dispatch_facility — BK = node_id. One row per delivery facility
    in the EPSS dispatch plan. This is the supply-vault facility dimension the
    Supply Control Tower needs (the vault was hub/environment grain only before).
*/
{{ config(materialized='incremental', on_schema_change='append_new_columns') }}
{{ automate_dv.hub(
    src_pk='hk_hcmis_dispatch_facility', src_nk='node_id',
    src_ldts='load_ts', src_source='record_source',
    source_model=['v_stg_hcmiswdm__dim_dispatchfacility']
) }}
