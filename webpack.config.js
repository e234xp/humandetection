const path = require('path');

module.exports = {
    target: "node",
    entry: ["babel-polyfill", path.resolve(__dirname, '', 'main_live_ai_capture_service.js')],
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'humandetection.bundle.js',
    },
    stats: {
        errorDetails: false
    },
    node: {
        __dirname: false
    },
    resolve: {
        // Add ".ts" and ".tsx" as resolvable extensions.
        extensions: [".js", ".tsx", ".ts", ".json", ".html"],
        modules: [
            path.resolve('.'),
            path.resolve('node_modules')
        ]
    },
    module: {
        rules: [
            // {
            //     test: /\.(png|jpe?g|gif|pem)$/,
            //     //exclude: /node_modules/,
            //     use: {
            //         loader: 'file-loader'
            //     },
            // },
            {
                test: /\.js$/,
                //exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: ['babel-preset-env'],
                        // plugins: ['@babel/plugin-syntax-dynamic-import'],
                        cacheDirectory: true,
                    },
                },
            },
            {
                test: /\.node$/,
                use: [{
                    loader: 'node-loader',
                    options: {
                        name: "[path][name].[ext]"
                    }
                }]
            }
        ]
    }
};