import { defineConfig } from 'vite';
import dns from 'dns';

dns.setDefaultResultOrder('verbatim');

export default defineConfig(() => {
    return {
        root: 'src/',
        publicDir: 'public/',
        server: {
            port: 3000
        },
        base: './',
    };
});
