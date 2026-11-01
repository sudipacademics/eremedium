import frappe
from frappe.model.document import Document
from frappe.utils import cint, now_datetime


def _sanitize(html: str | None) -> str:
    if not html:
        return ""
    try:
        from frappe.utils import sanitize_html

        return sanitize_html(html)
    except Exception:
        return html or ""


def _clear_cms_cache():
    try:
        cache = frappe.cache()
        # Bump generation so stale page/list keys are ignored
        gen = cint(cache.get_value("hec:cms:gen") or 0) + 1
        cache.set_value("hec:cms:gen", gen)
    except Exception:
        pass


def cms_cache_gen() -> int:
    try:
        return cint(frappe.cache().get_value("hec:cms:gen") or 0)
    except Exception:
        return 0


class SiteCMSPage(Document):
    def validate(self):
        self.page_key = (self.page_key or "").strip().lower()
        route = (self.route or self.page_key or "").strip().lower().lstrip("/")
        self.route = route
        if self.body:
            self.body = _sanitize(self.body)
        for row in self.get("blocks") or []:
            if row.content:
                row.content = _sanitize(row.content)
        if self.status == "Published" and not self.published_on:
            self.published_on = now_datetime()

    def on_update(self):
        _clear_cms_cache()

    def after_insert(self):
        _clear_cms_cache()

    def on_trash(self):
        _clear_cms_cache()
