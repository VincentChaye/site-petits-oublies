/* Les Petits Oubliés – calculateur du taux de glucides d'une croquette.
   Chargé uniquement par les fiches conseils qui déclarent `outil: "glucides"`.
   Amélioration progressive : le bloc de saisie est masqué dans le HTML (hidden)
   et n'est révélé que par ce script. Sans JavaScript, la formule reste lisible.
   Aucun JS en ligne : la CSP interdit `unsafe-inline`. */
(function () {
  'use strict';

  var CHAMPS = ['glu-proteines', 'glu-grasses', 'glu-cendres', 'glu-fibres', 'glu-humidite'];
  var ATTENTE = 'Renseignez les cinq valeurs pour obtenir le taux de glucides.';

  function nombre(el) {
    var brut = (el.value || '').trim().replace(',', '.');
    if (brut === '') { return null; }
    var n = Number(brut);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : NaN;
  }

  function init() {
    var bloc = document.querySelector('[data-calculateur-glucides]');
    var sortie = document.getElementById('glu-resultat');
    if (!bloc || !sortie) { return; }

    var champs = CHAMPS.map(function (id) { return document.getElementById(id); });
    if (champs.some(function (el) { return !el; })) { return; }

    bloc.hidden = false;

    function calculer() {
      var valeurs = champs.map(nombre);
      if (valeurs.some(function (v) { return Number.isNaN(v); })) {
        sortie.textContent = 'Une valeur est hors des bornes : indiquez des pourcentages entre 0 et 100.';
        return;
      }
      if (valeurs.some(function (v) { return v === null; })) {
        sortie.textContent = ATTENTE;
        return;
      }
      var somme = valeurs.reduce(function (t, v) { return t + v; }, 0);
      var glucides = 100 - somme;
      if (glucides < 0) {
        sortie.textContent = 'Le total des valeurs saisies dépasse 100 % : vérifiez les chiffres du paquet.';
        return;
      }
      var arrondi = Math.round(glucides * 10) / 10;
      var repere = arrondi < 25
        ? ' C’est en dessous du repère de 25 % conseillé par les experts.'
        : ' C’est au-dessus du repère de 25 % conseillé par les experts.';
      sortie.textContent = 'Taux de glucides estimé : ' + String(arrondi).replace('.', ',') + ' %.' + repere;
    }

    champs.forEach(function (el) {
      el.addEventListener('input', calculer);
      el.addEventListener('change', calculer);
    });
    calculer();
  }

  document.addEventListener('DOMContentLoaded', init);
}());
