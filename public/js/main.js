/* Les Petits Oubliés – amélioration progressive : menu mobile et formulaires.
   Sans le script, le menu reste déplié et le serveur valide les mêmes erreurs.
   Aucun JS en ligne : la CSP interdit `unsafe-inline`. */
(function () {
  'use strict';

  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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


  /* Menu replié sous le palier porté par `data-menu` (599 px sur le site public,
     899 px dans l'espace interne, qui compte dix entrées). Le bouton n'est révélé
     que si le script tourne : l'attribut data-ouvert n'existe pas sans lui, donc
     la liste reste visible et aucune entrée n'est perdue.
     Replier le menu rend `aria-expanded` cohérent avec ce qui est réellement
     affiché, et `Échap` referme sans quitter le clavier. */
  function initMenu(nav) {
    /* Le bouton est celui qui pilote cette liste (aria-controls pointe sur son id). */
    var liste = nav.querySelector('ul');
    var bouton = (liste && liste.id
      ? document.querySelector('.bouton-menu[aria-controls="' + liste.id + '"]')
      : null) || document.querySelector('.bouton-menu');
    if (!bouton) { return; }
    var palier = parseInt(nav.getAttribute('data-menu'), 10);
    if (!Number.isFinite(palier)) { palier = 599; }
    var etroit = window.matchMedia('(max-width: ' + palier + 'px)');

    function etat(ouvert) {
      nav.setAttribute('data-ouvert', ouvert ? 'oui' : 'non');
      bouton.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
    }

    function appliquer() {
      if (etroit.matches) {
        bouton.hidden = false;
        etat(nav.getAttribute('data-ouvert') === 'oui');
      } else {
        bouton.hidden = true;
        nav.removeAttribute('data-ouvert');
        bouton.setAttribute('aria-expanded', 'false');
      }
    }

    bouton.addEventListener('click', function () {
      etat(nav.getAttribute('data-ouvert') !== 'oui');
    });

    /* Échap referme le menu et ramène le focus sur le bouton qui l'ouvre. */
    nav.addEventListener('keydown', function (evt) {
      if (evt.key === 'Escape' && nav.getAttribute('data-ouvert') === 'oui') {
        etat(false);
        bouton.focus();
      }
    });
    bouton.addEventListener('keydown', function (evt) {
      if (evt.key === 'Escape' && nav.getAttribute('data-ouvert') === 'oui') {
        etat(false);
      }
    });

    if (typeof etroit.addEventListener === 'function') { etroit.addEventListener('change', appliquer); }
    appliquer();
  }

  document.addEventListener('DOMContentLoaded', function () {
    Array.prototype.forEach.call(document.querySelectorAll('nav.nav[data-menu]'), initMenu);
    Array.prototype.forEach.call(document.querySelectorAll('form[data-validation]'), initFormulaire);

    var cible = document.querySelector('[data-focus-initial]');
    if (cible) {
      cible.focus();
    }
  });

  /* Export statique (GitHub Pages) : sans serveur, les filtres du catalogue
     s'appliquent dans le navigateur à partir des attributs data-* des cartes. */
  var filtreLocal = document.querySelector('form[data-filtre-local]');
  if (filtreLocal) {
    var champsFiltre = ['espece', 'tranche', 'taille'];
    var appliquer = function () {
      var n = 0;
      var cartes = document.querySelectorAll('.liste-animaux > li');
      Array.prototype.forEach.call(cartes, function (li) {
        var ok = champsFiltre.every(function (c) {
          var v = filtreLocal.elements[c] ? filtreLocal.elements[c].value : '';
          return !v || li.getAttribute('data-' + c) === v;
        });
        li.hidden = !ok;
        if (ok) { n += 1; }
      });
      var res = document.querySelector('[data-resultats]');
      if (res) { res.textContent = n + (n > 1 ? ' animaux trouvés' : ' animal trouvé'); }
    };
    var params = new URLSearchParams(window.location.search);
    champsFiltre.forEach(function (c) {
      if (params.get(c) && filtreLocal.elements[c]) { filtreLocal.elements[c].value = params.get(c); }
    });
    filtreLocal.addEventListener('submit', function (e) {
      e.preventDefault();
      appliquer();
    });
    appliquer();
  }

  /* Export statique : formulaire affiché mais sans serveur pour le traiter. */
  Array.prototype.forEach.call(document.querySelectorAll('form[data-sans-envoi]'), function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      // Démo de connexion : rien n'est vérifié, on ouvre la page cible.
      if (f.hasAttribute('data-redirige')) { window.location.href = f.action; }
    });
  });
}());
