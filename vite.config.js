import { defineConfig } from 'vite';
import dns from 'dns';
import glsl from 'vite-plugin-glsl';

dns.setDefaultResultOrder('verbatim');

export default defineConfig(() => {
    return {
        root: 'src/',
        publicDir: 'public/',
        server: {
            port: 3000
        },
        base: './',
        plugins:
            [
                glsl()
            ]
    };
});
