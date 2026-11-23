/* Atelier de publication – version de démonstration (export GitHub Pages).
   Sans serveur : le préremplissage et l'aperçu sont calculés ici à partir des
   données exportées dans #atelier-demo (mêmes règles que interne-atelier.js).
   Le dépôt dans la file de validation est désactivé : rien n'est enregistré. */
(function () {
  'use strict';

  var source = document.getElementById('atelier-demo');
  var choix = document.querySelector('form[data-atelier-prefill]');
  var redaction = document.querySelector('form[data-atelier-demo]');
  if (!source || !choix || !redaction) { return; }

  var D;
  try { D = JSON.parse(source.textContent); } catch (e) { return; }

  var statut = document.querySelector('[data-atelier-statut]');
  var zone = document.querySelector('[data-atelier-apercu]');
  var meta = zone && zone.querySelector('[data-apercu-meta]');
  var carte = zone && zone.querySelector('[data-apercu-carte]');
  var titre = zone && zone.querySelector('h2');
  var RE_HASHTAG = /^#[\p{L}\p{N}_]+$/u;

  function pts(s) { return Array.from(s).length; }
  function valeur(nom) { return choix.elements[nom] ? choix.elements[nom].value : ''; }

  function el(tag, classe, texte) {
    var n = document.createElement(tag);
    if (classe) { n.className = classe; }
    if (texte !== undefined) { n.textContent = texte; }
    return n;
  }

  function afficherStatut(type, lignes) {
    if (!statut) { return; }
    statut.textContent = '';
    statut.className = type === 'erreur' ? 'resume-erreurs' : 'confirmation';
    statut.setAttribute('role', type === 'erreur' ? 'alert' : 'status');
    if (lignes.length === 1) {
      statut.appendChild(el('p', '', lignes[0]));
    } else {
      statut.appendChild(el('p', '', 'Votre publication n’a pas pu être traitée :'));
      var ul = el('ul');
      lignes.forEach(function (l) { ul.appendChild(el('li', '', l)); });
      statut.appendChild(ul);
    }
    statut.focus();
  }

  function effacerStatut() {
    if (statut) { statut.textContent = ''; statut.className = ''; statut.removeAttribute('role'); }
  }

  /* Étape 1 : préremplissage depuis le gabarit choisi. */
  choix.addEventListener('submit', function (e) {
    e.preventDefault();
    effacerStatut();
    var animal = valeur('animal');
    var reseau = valeur('reseau');
    var gabarit = valeur('gabarit');
    if (!animal) { afficherStatut('erreur', ['Choisissez une fiche.']); return; }
    if (!gabarit) { afficherStatut('erreur', ['Choisissez un gabarit pour préremplir (ou rédigez en texte libre).']); return; }
    var p = D.prefill[animal + '|' + reseau + '|' + gabarit];
    if (!p) { afficherStatut('erreur', ['Aucun gabarit disponible pour cette combinaison.']); return; }
    redaction.elements.texte.value = p.texte;
    redaction.elements.hashtags.value = p.hashtags;
    redaction.elements.texte.focus();
  });

  /* Étape 2 : validation et aperçu (mêmes règles que le serveur). */
  function valider() {
    var erreurs = [];
    var animal = D.animaux[valeur('animal')];
    var reseau = valeur('reseau');
    if (!animal) { erreurs.push('Choisissez une fiche existante.'); }
    if (!D.reseaux[reseau]) { erreurs.push('Réseau invalide : choisissez Instagram ou Facebook.'); }
    var texte = redaction.elements.texte.value.replace(/\r\n?/g, '\n').trim();
    if (!texte) { erreurs.push('Le texte est obligatoire.'); }
    var tags = [];
    var vus = {};
    redaction.elements.hashtags.value.split(/[\s,]+/).filter(Boolean).forEach(function (mot) {
      if (!RE_HASHTAG.test(mot)) { erreurs.push('Hashtag invalide : « ' + mot + ' » (un « # » suivi de lettres, chiffres ou « _ »).'); return; }
      var cle = mot.toLowerCase();
      if (!vus[cle]) { vus[cle] = true; tags.push(mot); }
    });
    var alt = redaction.elements.alt.value.trim();
    if (pts(alt) > D.altMax) { erreurs.push('Le texte alternatif est trop long (' + pts(alt) + ' caractères, maximum ' + D.altMax + ').'); }
    var texteFinal = tags.length ? texte + '\n\n' + tags.join(' ') : texte;
    var longueur = 0;
    if (D.reseaux[reseau]) {
      longueur = reseau === 'instagram' ? pts(texteFinal) : texteFinal.length;
      if (tags.length > D.hashtagsMax[reseau]) { erreurs.push('Trop de hashtags pour ' + D.reseaux[reseau] + ' : ' + tags.length + ' (maximum ' + D.hashtagsMax[reseau] + ').'); }
      if (longueur > D.limites[reseau]) { erreurs.push('Texte trop long pour ' + D.reseaux[reseau] + ' : ' + longueur + ' caractères avec les hashtags (maximum ' + D.limites[reseau] + ').'); }
      if (reseau === 'instagram' && animal && !animal.image) { erreurs.push('Instagram exige une image : cette fiche n’a pas de photo.'); }
    }
    return { erreurs: erreurs, animal: animal, reseau: reseau, tags: tags, texteFinal: texteFinal, alt: alt, longueur: longueur };
  }

  function afficherApercu(v) {
    var cad = v.reseau === 'instagram' ? (D.cadrages[valeur('cadrage')] || D.cadrages['1:1']) : D.facebook;
    var seuil = D.seuils[v.reseau];
    var car = Array.from(v.texteFinal);
    var coupe = car.length > seuil;
    var visible = coupe ? car.slice(0, seuil).join('').replace(/\s+$/, '') : v.texteFinal;

    titre.textContent = 'Aperçu ' + D.reseaux[v.reseau];
    meta.textContent = '';
    meta.appendChild(document.createTextNode('Format : '));
    meta.appendChild(el('strong', '', cad.libelle));
    meta.appendChild(document.createTextNode(' · Longueur : '));
    meta.appendChild(el('strong', '', String(v.longueur)));
    meta.appendChild(document.createTextNode(' / ' + D.limites[v.reseau] + ' caractères'));

    carte.className = 'apercu ' + cad.classe;
    carte.textContent = '';
    if (v.animal.image) {
      var img = el('img', 'apercu-image');
      img.src = v.animal.image;
      img.alt = v.alt || v.animal.imageAlt || '';
      img.width = cad.largeur;
      img.height = cad.hauteur;
      carte.appendChild(img);
    } else {
      carte.appendChild(el('p', 'etat-vide', 'Aucune image sur la fiche.'));
    }
    var p = el('p', 'texte-post', visible);
    if (coupe) { p.appendChild(document.createTextNode('… ')); p.appendChild(el('span', 'etiquette', 'plus')); }
    carte.appendChild(p);
    if (coupe) { carte.appendChild(el('p', 'aide', 'Le texte est coupé après ' + seuil + ' caractères dans le fil ; le lecteur doit toucher « … plus » pour lire la suite.')); }
    if (v.tags.length) { carte.appendChild(el('p', 'meta', 'Hashtags (' + v.tags.length + ') : ' + v.tags.join(' '))); }
    if (v.reseau === 'facebook') {
      var l = el('p', '', 'Lien de la fiche : ');
      var a = el('a', '', v.animal.url);
      a.href = v.animal.url;
      l.appendChild(a);
      carte.appendChild(l);
    } else {
      carte.appendChild(el('p', '', 'Lien de la fiche (non cliquable dans une légende Instagram) : ' + v.animal.url));
    }
    zone.hidden = false;
    titre.setAttribute('tabindex', '-1');
    titre.focus();
  }

  redaction.addEventListener('submit', function (e) {
    e.preventDefault();
    effacerStatut();
    var v = valider();
    if (v.erreurs.length) { afficherStatut('erreur', v.erreurs); return; }
    var bouton = e.submitter;
    if (bouton && bouton.hasAttribute('data-demo-deposer')) {
      afficherStatut('succes', ['Démonstration : la publication est valide. Dans la version complète, elle serait déposée dans la file de validation ; ici, rien n’est enregistré ni envoyé.']);
      return;
    }
    afficherApercu(v);
  });
}());
