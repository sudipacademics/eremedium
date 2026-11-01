frappe.pages["medical-department"].on_page_load = function () {
	var path = window.location.pathname || "";
	var segments = path.split("/").filter(Boolean);
	var slugIdx = segments.indexOf("medical-department");
	var tail =
		slugIdx >= 0 && segments.length > slugIdx + 1
			? decodeURIComponent(segments[slugIdx + 1])
			: null;

	if (tail === "new") {
		frappe.new_doc("Medical Department");
	} else if (tail) {
		frappe.set_route("Form", "Medical Department", tail);
	} else {
		frappe.set_route("List", "Medical Department");
	}
};
