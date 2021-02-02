const path = require("path");
const TerserPlugin = require("terser-webpack-plugin");
const webpack = require("webpack");

module.exports = (env, argv) => {
  return [
    {
      target: ["web"],
      entry: {},
      devtool,
      output: {
        library: "protobuf",
        filename: "[name].js",
        path: path.resolve(__dirname, "lib"),
        publicPath: "/",
      },
      module: {
        rules: [
          {
            test: /\.ts$/,
            use: [
              {
                loader: "ts-loader",
                options: {
                  transpileOnly: true,
                },
              },
            ],
            exclude: /node_modules/,
          }
        ],
      },
      resolve: {
        extensions: [".ts"],
        fallback: {
          "fs": false,
          "stream": require.resolve("stream-browserify"),
        },
      },
      optimization: {
        minimizer: [
          new TerserPlugin({
            parallel: true,
          }),
        ],
      },
    },
  ];
}
