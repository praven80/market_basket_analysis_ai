--tbl_market_basket_analysis
CREATE TABLE product_margin_and_sku_iceberg
WITH (
    table_type = 'ICEBERG',
    format = 'PARQUET', 
    location = 's3://amazon-q-poc-quicksight-test-bucket/iceberg_tables/product_margin_and_sku_iceberg/',
    is_external = false
)
AS
SELECT * FROM "db_market_basket_analysis"."product_margin_and_sku"