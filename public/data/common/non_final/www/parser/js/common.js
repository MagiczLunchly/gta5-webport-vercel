
// Compiled handlebars templates will go here, indexed by their ID
g_Handlebars = {}

$(document).ready(function() {
	// Register some helper functions for handlebars:
	
	// If a == b, output the text
	Handlebars.registerHelper('ifEq', function(a, b, options) {
		if (a === b) {
			return options.fn(this);
		}
		return options.inverse(this);
	});
	
	// If the current context has a key named 'item', output the text
	Handlebars.registerHelper('ifDefined', function(conditional, options) {
		if (conditional !== undefined) {
			return options.fn(this);
		}
		return options.inverse(this);
	});

	// Output a number as hex
	Handlebars.registerHelper('toHex', function(item) {
		return item ? "0x" + item.toString("16") : "";
	});

	// As soon as the page loads, we will look for all the handlebars templates and compile them. They should all have class="hbtemplate" 
	$(".hbtemplate").each(function(index) {
		g_Handlebars[this.id] = Handlebars.compile($(this).html());
	});
});

// Helper function for the array sort method, for selecting a key to sort by.
// Usage: spans.sort(sortWithKey(function(x) { return x.start; }));

function sortWithKey(sortKeyFn) {
	return function(a, b) {
		var aval = sortKeyFn(a),
			bval = sortKeyFn(b);
		if (aval < bval) { return -1; }
		if (aval > bval) { return 1; }
		return 0;
	};
}

function findElementInCollectionWithKey(collection, keyName, keyValue) {
	if (collection instanceof Array) {
		var len = collection.length;
		for(var i = 0; i < len; i++) {
			if (collection[i][keyName] == keyValue) {
				return collection[i];
			}
		}
	}
	else if (collection instanceof Object) {
		for(var key in collection) {
			if (collection.hasOwnProperty(key)) {
				if (collection[key][keyName] == keyValue) {
					return collection[key];
				}
			}
		}
	}
	return null;
}
