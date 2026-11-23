/* Espace interne – confirmations avant une action destructrice.
   Le menu repliable et le focus initial des messages viennent de main.js,
   chargé par le même gabarit. Aucun JS inline ; sans ce script, tout reste
   utilisable (la confirmation disparaît, l'action reste possible). */
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
  });
}());
