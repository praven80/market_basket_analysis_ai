--tbl_market_basket_analysis
CREATE TABLE tbl_market_basket_analysis
WITH (
    table_type = 'ICEBERG',
    format = 'PARQUET', 
    location = 's3://amazon-q-poc-quicksight-test-bucket/tbl_market_basket_analysis/',
    is_external = false
) 
AS
WITH DistinctSKU AS (
    SELECT 
        sku.product_part_number, 
        sku.financial_calendar_reporting_week,
        MAX(sku.net_sales) AS net_sales,
        MAX(sku.gross_margin) AS gross_margin
    FROM 
        "db_market_basket_analysis"."product_margin_and_sku" sku
    GROUP BY 
        sku.product_part_number, 
        sku.financial_calendar_reporting_week
),
max_week_dates AS (
    SELECT 
        financial_calendar_reporting_week,
        MAX(financial_calendar_first_day_reporting_week) AS financial_calendar_first_day_reporting_week,
        MAX(financial_calendar_last_day_reporting_week) AS financial_calendar_last_day_reporting_week
    FROM 
        "prd_use1_ecom_gold_schema"."common_date"
    GROUP BY 
        financial_calendar_reporting_week
),
OrderLineBase AS (
    SELECT
        ol.order_id,
        ol.order_line_id,
        ol.product_id,
        ol.customer_id,
        ol.order_placed_dttm,
        ol.financial_calendar_reporting_week,
        ol.order_line_quantity,
        ol.order_line_each_price,
        ol.order_line_currency,
        ol.order_line_total_price,
        ol.order_line_total_adjustment
    FROM
        "prd_use1_ecom_gold_schema"."order_line_base" ol
    WHERE
        DATE_FORMAT(ol.order_placed_dttm, '%Y') = '2024'
        AND ol.financial_calendar_reporting_week LIKE '2024%'
),
ProductMargins AS (
    SELECT 
        ol.order_id,
        ol.product_id,
        MAX(ol.order_line_quantity),
        MAX(ol.order_line_each_price),
        MAX(s.gross_margin) AS sku_gross_margin,
        MAX(s.net_sales) AS sku_net_sales,
        MAX((s.gross_margin / NULLIF(s.net_sales, 0))) AS calculated_product_margin,
        MAX((s.gross_margin / NULLIF(s.net_sales, 0)) * ol.order_line_each_price * ol.order_line_quantity) AS calculated_gross_product_margin,
        MAX(ol.order_line_each_price * ol.order_line_quantity) AS calculated_product_cost
    FROM 
        OrderLineBase ol
    LEFT JOIN 
        "prd_use1_pdm_gold_schema"."product" p 
        ON ol.product_id = p.product_id 
    LEFT JOIN 
        DistinctSKU s
        ON CAST(s.product_part_number AS VARCHAR) = p.part_number
        AND s.financial_calendar_reporting_week = ol.financial_calendar_reporting_week
    GROUP BY
        ol.order_id,
        ol.product_id
),
BasketMargins AS (
    SELECT
        order_id,
        product_id,
        calculated_product_margin,
        calculated_gross_product_margin,
        calculated_product_cost,
        SUM(sku_gross_margin) OVER (PARTITION BY order_id) / NULLIF(SUM(sku_net_sales) OVER (PARTITION BY order_id), 0) AS calculated_basket_margin
    FROM
        ProductMargins
),
ProductReturns AS (
	SELECT
		r.order_id AS order_id,
		r.order_line_id AS order_line_id,
		MAX(r.return_item_id) AS return_item_id,
		SUM(r.return_quantity) AS return_quantity,
	    MAX(r.return_reason_id) AS return_reason_id,
	    MAX(r.return_reason_description) AS return_reason_description,
	    MAX(r.return_refund_or_replace_code) AS return_refund_or_replace_code,
	    SUM(r.return_total_credit_amount) AS return_total_credit_amount
	FROM "prd_use1_ecom_gold_schema"."return_measures" r 
    WHERE r.RETURN_REFUND_OR_REPLACE_CODE <> 'CON'
    GROUP BY r.order_id, r.order_line_id 
),
ProductPromotions AS (
	SELECT 
	    pro.product_id, 
	    MAX(pro.promotion_id) AS promotion_id,
	    MAX(pro.status) AS status, 
	    MAX(pro.name) AS name, 
	    MAX(pro.short_description) AS short_description, 
	    MAX(pro.promotion_type) AS promotion_type, 
	    MAX(pro.start_date) AS start_date, 
	    MAX(pro.end_date) AS end_date
	FROM tbl_promotion_product pro
	WHERE DATE_FORMAT(pro.start_date, '%Y') = '2024' 
	   OR DATE_FORMAT(pro.end_date, '%Y') = '2024'
	GROUP BY pro.product_id
)
SELECT
    p.product_id,
    p.part_number AS product_part_number,
    c.customer_id,
    o.order_id,
    ol.order_line_id,
    r.return_item_id,
    pro.promotion_id AS product_promotion_id,
    
    d.financial_calendar_first_day_reporting_week,
    d.financial_calendar_last_day_reporting_week,
    
    p.name AS product_name,
    p.manufacturer_name AS product_manufacturer_name,
    p.category_level1 AS product_category_level1,
    p.category_level2 AS product_category_level2,
    p.category_level3 AS product_category_level3,
    p.merch_classification1 AS product_merchant_classification1,
    p.merch_classification2 AS product_merchant_classification2,
    p.merch_classification3 AS product_merchant_classification3,
    p.merch_classification4 AS product_merchant_classification4,
    p.product_type AS product_type,
    p.unit_cost AS unit_cost,
    p.price AS product_price,
    p.rating_avg AS product_rating_avg,
    p.rating_cnt AS product_rating_count,
    p.discontinued_flag AS product_discontinued_flag,
    p.rx_vet_auth_flag AS product_rx_vet_auth_flag,

    c.city AS customer_city,
    c.state AS customer_state,
    c.country AS customer_country,
    c.zip AS customer_zip,
    c.customer_order_last_placed_dttm AS customer_order_last_placed_dttm,
    c.autoship_active_flag AS autoship_active_flag,

    o.order_status AS order_status,
    o.order_cancel_reason AS order_cancel_reason,

    ol.order_placed_dttm AS order_line_order_placed_dttm,
    ol.order_line_quantity AS order_line_quantity,
    ol.order_line_each_price AS order_line_each_price,
    ol.order_line_currency AS order_line_currency,

    r.return_quantity AS return_quantity,
    r.return_reason_id AS return_reason_id,
    r.return_reason_description AS return_reason_description,
    r.return_refund_or_replace_code AS return_refund_or_replace_code,
    r.return_total_credit_amount AS return_total_credit_amount,

    bm.calculated_product_margin AS calculated_product_margin,
    bm.calculated_basket_margin AS calculated_basket_margin,
    bm.calculated_gross_product_margin AS calculated_gross_product_margin,
    bm.calculated_product_cost AS calculated_product_cost,

	pro.status AS product_promotion_status, 
	pro.name AS product_promotion_name, 
	pro.short_description AS product_promotion_short_description, 
	pro.promotion_type AS product_promotion__type, 
	pro.start_date AS product_promotion_start_date, 
	pro.end_date AS product_promotion_end_date
FROM 
    OrderLineBase ol
LEFT JOIN
    "prd_use1_ecom_gold_schema"."orders" o
    ON o.order_id = ol.order_id
LEFT JOIN 
    "prd_use1_pdm_gold_schema"."product" p 
    ON ol.product_id = p.product_id
LEFT JOIN 
    "prd_use1_cdm_gold_schema"."customer" c 
    ON ol.customer_id = c.customer_id
LEFT JOIN 
    ProductReturns r 
    ON ol.order_id = r.order_id
    AND ol.order_line_id = r.order_line_id
LEFT JOIN 
    max_week_dates d
    ON d.financial_calendar_reporting_week = ol.financial_calendar_reporting_week
LEFT JOIN 
    BasketMargins bm
    ON ol.order_id = bm.order_id
    AND ol.product_id = bm.product_id
LEFT JOIN
	ProductPromotions pro
	ON ol.product_id = pro.product_id
    AND ol.order_placed_dttm BETWEEN CAST(pro.start_date AS timestamp) AND CAST(pro.end_date AS timestamp)