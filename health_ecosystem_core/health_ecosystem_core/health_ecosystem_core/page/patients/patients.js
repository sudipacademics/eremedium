frappe.pages.patients.on_page_load = function () {
	var path = window.location.pathname || "";
	var segments = path.split("/").filter(Boolean);
	var slugIdx = segments.indexOf("patients");
	var tail =
		slugIdx >= 0 && segments.length > slugIdx + 1
			? decodeURIComponent(segments[slugIdx + 1])
			: null;

	if (tail === "new") {
		frappe.new_doc("Patient");
	} else if (tail) {
		frappe.set_route("Form", "Patient", tail);
	} else {
		frappe.set_route("List", "Patient");
	}
};
