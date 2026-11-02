/* Refuge des Quatre Vents (démo) – amélioration progressive des formulaires.
   Sans le script, le serveur valide et affiche les mêmes erreurs. Aucun JS inline. */
(function () {
  'use strict';

  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function champDe(form, nom) {
    return form.elements.namedItem(nom);
  }

  function messageErreur(el) {
    return el.getAttribute('data-erreur') || 'Ce champ est à corriger.';
  }

  function estValide(el) {
    if (el.type === 'checkbox') {
      return !el.required || el.checked;
    }
    var v = (el.value || '').trim();
    if (!v) {
      return !el.required;
    }
    if (el.type === 'email') {
      return EMAIL.test(v);
    }
    if (el.type === 'tel') {
      return /^[0-9 +().-]{6,20}$/.test(v);
    }
    return true;
  }

  function afficher(el, valide) {
    var zone = document.getElementById(el.id + '-erreur');
    var conteneur = el.closest('.champ');
    if (!zone || !conteneur) {
      return;
    }
    var aide = document.getElementById(el.id + '-aide');
    var ids = [];
    if (aide) { ids.push(aide.id); }
    if (valide) {
      zone.hidden = true;
      zone.textContent = '';
      el.removeAttribute('aria-invalid');
      conteneur.classList.remove('champ-erreur');
    } else {
      zone.hidden = false;
      zone.textContent = messageErreur(el);
      el.setAttribute('aria-invalid', 'true');
      conteneur.classList.add('champ-erreur');
      ids.push(zone.id);
    }
    if (ids.length) {
      el.setAttribute('aria-describedby', ids.join(' '));
    } else {
      el.removeAttribute('aria-describedby');
    }
  }

  function initFormulaire(form) {
    var champs = Array.prototype.filter.call(form.elements, function (el) {
      return el.hasAttribute('data-erreur');
    });

    champs.forEach(function (el) {
      el.addEventListener('blur', function () {
        if (el.type !== 'checkbox') { afficher(el, estValide(el)); }
      });
      el.addEventListener('change', function () { afficher(el, estValide(el)); });
    });

    form.addEventListener('submit', function (evt) {
      var premier = null;
      champs.forEach(function (el) {
        var ok = estValide(el);
        afficher(el, ok);
        if (!ok && !premier) { premier = el; }
      });
      if (premier) {
        evt.preventDefault();
        premier.focus();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    Array.prototype.forEach.call(document.querySelectorAll('form[data-validation]'), initFormulaire);

    var cible = document.querySelector('[data-focus-initial]');
    if (cible) {
      cible.focus();
    }
  });
}());
