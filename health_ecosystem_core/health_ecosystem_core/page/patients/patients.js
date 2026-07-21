frappe.pages.patients.on_page_load = function () {
	const path = window.location.pathname || "";
	if (path.endsWith("/new")) {
		frappe.new_doc("Patient");
	} else {
		frappe.set_route("List", "Patient");
	}
};
