frappe.pages.practitioner.on_page_load = function () {
	var pending = null;
	try {
		pending = sessionStorage.getItem("hec_pending_route");
	} catch (e) {
		pending = null;
	}
	if (pending) {
		try {
			sessionStorage.removeItem("hec_pending_route");
			frappe.set_route.apply(frappe, JSON.parse(pending));
			return;
		} catch (e) {
			/* fall through */
		}
	}

	var path = window.location.pathname || "";
	if (path.endsWith("/new")) {
		frappe.new_doc("Healthcare Practitioner");
	} else {
		frappe.set_route("List", "Healthcare Practitioner");
	}
};
