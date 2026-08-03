const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
require('dotenv').config();

// Two build modes (see src/config/endpoints.ts):
//   local  (default) — desktop app on :8420, full actions
//   hosted           — Cloudflare Pages build, reads through the read-only
//                      Worker proxy, actions disabled
const MODE = process.env.CELLSTRUCTS_MODE === 'hosted' ? 'hosted' : 'local';

// Build-time defaults injected from .env (see .env.example). Runtime settings
// (localStorage via the in-app settings panel) override these.
const ENV_DEFAULTS = {
  'process.env.CELLSTRUCTS_MODE': JSON.stringify(MODE),
  'process.env.CELLSTRUCTS_PROXY_URL': JSON.stringify(process.env.CELLSTRUCTS_PROXY_URL || ''),
  'process.env.CELLSTRUCTS_DESKTOP_API_URL': JSON.stringify(process.env.CELLSTRUCTS_DESKTOP_API_URL || '/desktop'),
  // A hosted bundle is public: never bake the local desktop bearer token into
  // it, even when one happens to be present in .env on the build machine.
  'process.env.CELLSTRUCTS_DESKTOP_API_TOKEN': JSON.stringify(
    MODE === 'hosted' ? '' : process.env.CELLSTRUCTS_DESKTOP_API_TOKEN || '',
  ),
  'process.env.CELLSTRUCTS_LCD_URL': JSON.stringify(process.env.CELLSTRUCTS_LCD_URL || ''),
  'process.env.CELLSTRUCTS_RPC_URL': JSON.stringify(process.env.CELLSTRUCTS_RPC_URL || (MODE === 'hosted' ? '' : '/rpc')),
  'process.env.CELLSTRUCTS_PLAYER_ID': JSON.stringify(process.env.CELLSTRUCTS_PLAYER_ID || ''),
};

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';
  return {
    entry: './src/index.ts',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isProd ? 'cellstructs.[contenthash].js' : 'cellstructs.js',
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.js'],
      // CosmJS references Node builtins it doesn't need in the browser
      fallback: { crypto: false, stream: false, path: false, buffer: false },
    },
    module: {
      rules: [{ test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ }],
    },
    plugins: [
      new HtmlWebpackPlugin({ template: 'src/index.html' }),
      new webpack.DefinePlugin(ENV_DEFAULTS),
    ],
    devtool: isProd ? 'source-map' : 'eval-source-map',
    performance: { hints: false },
    devServer: {
      port: 8421,
      // The desktop app's MCP server requires the bearer token even on CORS
      // preflight (OPTIONS carries no Authorization header by design), so
      // browsers cannot call :8420 cross-origin. In dev we proxy same-origin
      // paths instead; the Authorization header passes straight through.
      proxy: [
        {
          context: ['/desktop'],
          target: process.env.CELLSTRUCTS_DESKTOP_PROXY_TARGET || 'http://127.0.0.1:8420',
          pathRewrite: { '^/desktop': '' },
          changeOrigin: true,
        },
        {
          context: ['/rpc'],
          target: process.env.CELLSTRUCTS_RPC_PROXY_TARGET || 'http://127.0.0.1:26657',
          pathRewrite: { '^/rpc': '' },
          changeOrigin: true,
        },
      ],
    },
  };
};
