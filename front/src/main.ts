import { createApp } from "vue";
import App from "@/App.vue";
import * as store from '@/store';

import '@mdi/font/css/materialdesignicons.css';

import 'vuetify/styles';
import { createVuetify } from 'vuetify';

import Highcharts from 'highcharts';
Highcharts.setOptions({
    accessibility: { enabled: false },
    lang: { locale: 'en' },
});


const vuetify = createVuetify({
    theme: {
        defaultTheme: 'dark',
    },
});

const app = createApp(App);

// register global variables
for (const _key in store) {
    const key = _key as keyof typeof store;
    app.provide(key, store[key]);
}

app.config.errorHandler = (err) => {
    alert(err);
    console.error(err);
}

app
    .use(vuetify)
    .mount("#app");
