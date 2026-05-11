/**
 * Tests for AAuthFrame (#556 — A direction auth shell).
 *
 * 検証: title / subtitle / children を描画し、devstream brand link を出す。
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AAuthFrame from "@/components/layout-a/AAuthFrame";

describe("AAuthFrame", () => {
	it("title / subtitle / children を描画し、devstream brand link を出す", () => {
		render(
			<AAuthFrame title="ログイン" subtitle="副題テキスト">
				<form data-testid="auth-form" />
			</AAuthFrame>,
		);

		expect(
			screen.getByRole("heading", { name: "ログイン" }),
		).toBeInTheDocument();
		expect(screen.getByText("副題テキスト")).toBeInTheDocument();
		expect(screen.getByTestId("auth-form")).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "devstream ホームへ戻る" }),
		).toHaveAttribute("href", "/");
	});

	it("subtitle 省略時は描画されない", () => {
		render(
			<AAuthFrame title="ログイン">
				<div />
			</AAuthFrame>,
		);

		expect(
			screen.getByRole("heading", { name: "ログイン" }),
		).toBeInTheDocument();
		expect(screen.queryByText("副題テキスト")).toBeNull();
	});
});
