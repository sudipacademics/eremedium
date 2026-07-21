import frappe


def execute():
    """Add composite indexes for high-volume query patterns."""
    indexes = [
        (
            "tabCustomer TRF",
            "idx_trf_franchisee_status",
            "franchisee_id, order_status, creation",
        ),
        (
            "tabCustomer TRF",
            "idx_trf_barcode",
            "unique_barcode",
        ),
        (
            "tabLab Test Result",
            "idx_result_barcode",
            "barcode_link, verification_timestamp",
        ),
        (
            "tabPharmacy Order",
            "idx_pharmacy_status",
            "delivery_status, razorpay_payment_status",
        ),
    ]

    for table, index_name, columns in indexes:
        if not frappe.db.has_table(table.replace("tab", "")):
            continue
        existing = frappe.db.sql(
            f"SHOW INDEX FROM `{table}` WHERE Key_name = %s", (index_name,)
        )
        if existing:
            continue
        try:
            frappe.db.sql_ddl(
                f"CREATE INDEX `{index_name}` ON `{table}` ({columns})"
            )
        except Exception:
            pass
