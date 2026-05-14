/**
 * /search/users 検索中の skeleton fallback (#694)。
 *
 * Next.js App Router の Suspense Boundary。 SSR 完了までこの placeholder を
 * 出す。 page.tsx は server component で serverFetch を待つので、 何も出ない
 * 時間帯を埋める UX 改善。
 */

export default function LoadingUserSearch() {
	return (
		<>
			<header
				className="flex items-center gap-3 px-5 py-3"
				style={{ borderBottom: "1px solid var(--a-border)" }}
			>
				<div className="min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						ユーザー検索
					</h1>
				</div>
			</header>
			<div className="px-5 py-5">
				<div
					className="mb-6 h-10 animate-pulse rounded-md"
					style={{ background: "var(--a-bg-muted)" }}
					aria-hidden="true"
				/>
				<ul role="list" className="space-y-2" aria-label="検索結果を読み込み中">
					{[1, 2, 3].map((i) => (
						<li
							key={i}
							className="flex items-start gap-3 rounded-lg border p-3"
							style={{ borderColor: "var(--a-border)" }}
						>
							<div
								className="size-12 shrink-0 animate-pulse rounded-full"
								style={{ background: "var(--a-bg-muted)" }}
								aria-hidden="true"
							/>
							<div className="flex-1 space-y-2">
								<div
									className="h-4 w-1/3 animate-pulse rounded"
									style={{ background: "var(--a-bg-muted)" }}
									aria-hidden="true"
								/>
								<div
									className="h-3 w-2/3 animate-pulse rounded"
									style={{ background: "var(--a-bg-muted)" }}
									aria-hidden="true"
								/>
							</div>
						</li>
					))}
				</ul>
			</div>
		</>
	);
}
