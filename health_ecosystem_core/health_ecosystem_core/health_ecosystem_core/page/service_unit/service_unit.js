frappe.pages["service-unit"].on_page_load = function () {
	var path = window.location.pathname || "";
	var segments = path.split("/").filter(Boolean);
	var slugIdx = segments.indexOf("service-unit");
	var tail =
		slugIdx >= 0 && segments.length > slugIdx + 1
			? decodeURIComponent(segments[slugIdx + 1])
			: null;

	if (tail === "new") {
		frappe.new_doc("Healthcare Service Unit");
	} else if (tail) {
		frappe.set_route("Form", "Healthcare Service Unit", tail);
	} else {
		frappe.set_route("List", "Healthcare Service Unit");
	}
};
