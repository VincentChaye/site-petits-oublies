/* Espace interne – confirmations et focus. Aucun JS inline ; sans ce script, tout reste utilisable. */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    Array.prototype.forEach.call(document.querySelectorAll('form[data-confirm]'), function (form) {
      form.addEventListener('submit', function (evt) {
        if (!window.confirm(form.getAttribute('data-confirm'))) {
          evt.preventDefault();
        }
      });
    });

    var cible = document.querySelector('[data-focus-initial]');
    if (cible) {
      cible.focus();
    }
  });
}());
