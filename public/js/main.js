/* Les Petits Oubliés – amélioration progressive : menu mobile et formulaires.
   Sans le script, le menu reste déplié et le serveur valide les mêmes erreurs.
   Aucun JS en ligne : la CSP interdit `unsafe-inline`. */
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


  /* Menu replié sous 600 px. Le bouton n'est révélé que si le script tourne ;
     l'attribut data-ouvert n'existe pas sans lui, donc la liste reste visible. */
  function initMenu() {
    var nav = document.querySelector('nav.nav[data-menu]');
    var bouton = document.querySelector('.bouton-menu');
    if (!nav || !bouton) { return; }
    var etroit = window.matchMedia('(max-width: 599px)');

    function appliquer() {
      if (etroit.matches) {
        bouton.hidden = false;
        if (!nav.hasAttribute('data-ouvert')) { nav.setAttribute('data-ouvert', 'non'); }
        bouton.setAttribute('aria-expanded', nav.getAttribute('data-ouvert') === 'oui' ? 'true' : 'false');
      } else {
        bouton.hidden = true;
        nav.removeAttribute('data-ouvert');
        bouton.setAttribute('aria-expanded', 'false');
      }
    }

    bouton.addEventListener('click', function () {
      var ouvert = nav.getAttribute('data-ouvert') === 'oui';
      nav.setAttribute('data-ouvert', ouvert ? 'non' : 'oui');
      bouton.setAttribute('aria-expanded', ouvert ? 'false' : 'true');
    });

    if (typeof etroit.addEventListener === 'function') { etroit.addEventListener('change', appliquer); }
    appliquer();
  }

  document.addEventListener('DOMContentLoaded', function () {
    initMenu();
    Array.prototype.forEach.call(document.querySelectorAll('form[data-validation]'), initFormulaire);

    var cible = document.querySelector('[data-focus-initial]');
    if (cible) {
      cible.focus();
    }
  });
}());
