-- Staging: clean plant master; exposes company code + local currency + country.

select
    trim(WERKS)  as plant_code,
    trim(NAME1)  as plant_name,
    trim(LAND1)  as country,
    trim(BUKRS)  as company_code,
    trim(WAERS)  as local_currency,
    trim(ORT01)  as city
from {{ source('sap_raw', 'T001W_RAW') }}
