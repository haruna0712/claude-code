/**
 * Tests for nav-active helper (#685).
 */

import { describe, expect, it } from "vitest";

import { isNavItemActive, resolveActiveHref } from "@/lib/nav-active";

const ITEMS = [
	{ href: "/" },
	{ href: "/search" },
	{ href: "/search/users" },
	{ href: "/messages" },
	{ href: "/articles" },
];

describe("resolveActiveHref", () => {
	it("exact match on root", () => {
		expect(resolveActiveHref(ITEMS, "/")).toBe("/");
	});

	it("does NOT activate root for deeper paths", () => {
		expect(resolveActiveHref(ITEMS, "/search")).toBe("/search");
		expect(resolveActiveHref(ITEMS, "/messages/123")).toBe("/messages");
	});

	it("picks the longest prefix when nested siblings exist (#685 root cause)", () => {
		// `/search` と `/search/users` の両方が match するが、 longer prefix が勝つ
		expect(resolveActiveHref(ITEMS, "/search/users")).toBe("/search/users");
	});

	it("activates /search (not /search/users) when pathname is /search exactly", () => {
		expect(resolveActiveHref(ITEMS, "/search")).toBe("/search");
	});

	it("activates /messages for descendant paths", () => {
		expect(resolveActiveHref(ITEMS, "/messages/42")).toBe("/messages");
		expect(resolveActiveHref(ITEMS, "/messages/42/edit")).toBe("/messages");
	});

	it("returns null when no item matches", () => {
		expect(resolveActiveHref(ITEMS, "/explore")).toBeNull();
		expect(resolveActiveHref(ITEMS, "/u/test2")).toBeNull();
	});

	it("does NOT false-positive partial-segment match (e.g. /searchbar vs /search)", () => {
		// `/searchbar` は `/search` の descendant ではないので非 active
		expect(resolveActiveHref(ITEMS, "/searchbar")).toBeNull();
	});

	it("empty items returns null", () => {
		expect(resolveActiveHref([], "/anything")).toBeNull();
	});
});

describe("isNavItemActive", () => {
	it("returns true only for the most specific match", () => {
		expect(isNavItemActive("/search", ITEMS, "/search/users")).toBe(false);
		expect(isNavItemActive("/search/users", ITEMS, "/search/users")).toBe(true);
	});

	it("activates /search on its own page", () => {
		expect(isNavItemActive("/search", ITEMS, "/search")).toBe(true);
		expect(isNavItemActive("/search/users", ITEMS, "/search")).toBe(false);
	});

	it("activates / only on root", () => {
		expect(isNavItemActive("/", ITEMS, "/")).toBe(true);
		expect(isNavItemActive("/", ITEMS, "/search")).toBe(false);
	});
});
