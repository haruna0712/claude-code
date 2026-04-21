import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {};

// Sentry webpack plugin options. DSN やプロジェクト設定は env 経由。
// See: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
const sentryWebpackPluginOptions = {
  // 組織・プロジェクト名は CI で env から渡す (SENTRY_ORG / SENTRY_PROJECT)。
  // Auth token も SENTRY_AUTH_TOKEN (GitHub Actions secret) で提供。
  silent: true, // ビルドログのノイズを減らす
  // sourceMaps を Sentry にアップロードするがクライアントには公開しない
  hideSourceMaps: true,
  // 未使用のバンドル解析を省略
  disableLogger: true,
};

const sentryOptions = {
  // Sentry SDK の tunneling を有効化してアドブロッカー経由での計測漏れを抑止
  // 参考: https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/adblockers/
  tunnelRoute: "/monitoring/sentry",
};

// DSN が未設定のローカル環境では Sentry ラッピングをスキップし、
// ビルド時の auth token エラーを避ける。
const hasDsn = Boolean(
  process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN,
);

export default hasDsn
  ? withSentryConfig(nextConfig, sentryWebpackPluginOptions, sentryOptions)
  : nextConfig;
