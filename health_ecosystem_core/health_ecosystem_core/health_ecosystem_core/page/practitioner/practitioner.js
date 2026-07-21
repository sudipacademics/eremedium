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
	var segments = path.split("/").filter(Boolean);
	var slugIdx = segments.indexOf("practitioner");
	var tail =
		slugIdx >= 0 && segments.length > slugIdx + 1
			? decodeURIComponent(segments[slugIdx + 1])
			: null;

	if (tail === "new") {
		frappe.new_doc("Healthcare Practitioner");
	} else if (tail) {
		frappe.set_route("Form", "Healthcare Practitioner", tail);
	} else {
		frappe.set_route("List", "Healthcare Practitioner");
	}
};
