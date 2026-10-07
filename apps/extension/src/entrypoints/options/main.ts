import { browser } from 'wxt/browser';

// Perch keeps all settings inside the full-screen reader so there is a single
// place to manage everything. The options page just forwards there.
location.replace(browser.runtime.getURL('/reader.html#/settings'));
