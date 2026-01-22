import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import CharacterView from '../views/CharacterView.vue';
import OkiCalculatorView from '../views/OkiCalculatorView.vue';

const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        {
            path: '/',
            name: 'home',
            component: HomeView,
        },
        {
            path: '/character/:id',
            name: 'character',
            component: CharacterView,
        },
        {
            path: '/oki',
            name: 'oki',
            component: OkiCalculatorView,
        },
    ],
});

export default router;
