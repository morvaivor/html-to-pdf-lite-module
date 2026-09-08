import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function generateHeavyLedger(): string {
  const journals = [
    { code: 'ACH', name: 'Journal des Achats & Fournisseurs', color: '#0284c7' },
    { code: 'VTE', name: 'Journal des Ventes & Facturation Clients', color: '#16a34a' },
    { code: 'BNQ', name: 'Journal de Trésorerie & Opérations Bancaires', color: '#6366f1' },
    { code: 'SAL', name: 'Journal des Rémunérations & Charges Sociales', color: '#d97706' },
    { code: 'OD',  name: 'Journal des Opérations Diverses & Amortissements', color: '#dc2626' }
  ];

  const suppliers = [
    'Amazon Web Services EMEA', 'Google Cloud Ireland', 'Datadog SAS', 'GitHub Inc',
    'OVHcloud SAS', 'Stripe Payments Europe', 'Slack Technologies', 'Atlassian Pty',
    'Cloudflare Inc', 'Equinix France Datacenter', 'Dell Technologies France', 'JetBrains s.r.o.'
  ];

  const clients = [
    'BNP Paribas CIB', 'Société Générale Global', 'Crédit Agricole Titres',
    'AXA Assurance France', 'Airbus CyberSecurity', 'Thales Digital Solutions',
    'TotalEnergies Digital', 'Sanofi Healthcare France', 'L\'Oréal Global IT', 'Capgemini France'
  ];

  const months = [
    { num: '01', name: 'Janvier 2026' },
    { num: '02', name: 'Février 2026' },
    { num: '03', name: 'Mars 2026' },
    { num: '04', name: 'Avril 2026' },
    { num: '05', name: 'Mai 2026' },
    { num: '06', name: 'Juin 2026' },
    { num: '07', name: 'Juillet 2026' },
    { num: '08', name: 'Août 2026' },
    { num: '09', name: 'Septembre 2026' },
    { num: '10', name: 'Octobre 2026' },
    { num: '11', name: 'Novembre 2026' },
    { num: '12', name: 'Décembre 2026' }
  ];

  let html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Grand Livre Comptable Général & Audit Financier Annuel 2026</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 18px 20px;
      @top-left {
        content: "NEXUS GROUP HOLDING • GRAND LIVRE COMPTABLE ANNUEL EXERCICE 2026";
        font-size: 7.5px;
        color: #64748b;
        font-family: Helvetica;
      }
      @top-right {
        content: "AUDIT OFFICIEL CERTIFIÉ • ÉDITION VOLUMINEUSE";
        font-size: 7.5px;
        color: #0369a1;
        font-weight: bold;
        font-family: Helvetica;
      }
      @bottom-left {
        content: "Commissariat aux Comptes • Réf: AUDIT-2026-GL-EXP";
        font-size: 7.5px;
        color: #94a3b8;
        font-family: Helvetica;
      }
      @bottom-center {
        content: "Page " counter(page) " sur " counter(num-pages);
        font-size: 8px;
        color: #475569;
        font-family: Helvetica;
      }
      @bottom-right {
        content: "Nexus Group Holding SAS";
        font-size: 7.5px;
        color: #64748b;
        font-family: Helvetica;
      }
    }

    body {
      font-family: Helvetica, Arial, sans-serif;
      color: #0f172a;
      margin: 0;
      padding: 0;
      font-size: 8.5px;
      line-height: 1.35;
    }

    /* En-tête */
    .header-card {
      border: 1.5px solid #0284c7;
      background-color: #f0f9ff;
      padding: 10px 14px;
      margin-bottom: 12px;
    }

    .main-title {
      font-size: 18px;
      font-weight: bold;
      color: #0c4a6e;
      margin: 0 0 4px 0;
    }

    .sub-meta {
      font-size: 8.5px;
      color: #475569;
    }

    .badge-stress {
      background-color: #dc2626;
      color: #ffffff;
      font-size: 7.5px;
      font-weight: bold;
      padding: 2px 6px;
      border-radius: 3px;
      display: inline-block;
      margin-left: 8px;
    }

    /* Grille de synthèse */
    table.summary-grid {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
      border: 1px solid #cbd5e1;
    }

    table.summary-grid td {
      padding: 6px 10px;
      border: 1px solid #cbd5e1;
      background-color: #ffffff;
      font-size: 8.5px;
    }

    .kpi-title {
      font-size: 7.5px;
      color: #64748b;
      text-transform: uppercase;
      font-weight: bold;
    }

    .kpi-val {
      font-size: 13px;
      font-weight: bold;
      color: #0369a1;
      margin-top: 2px;
    }

    /* Tables comptables */
    .month-header {
      background-color: #0f172a;
      color: #ffffff;
      font-size: 9.5px;
      font-weight: bold;
      padding: 4px 8px;
      margin-top: 14px;
      margin-bottom: 0;
      letter-spacing: 0.5px;
    }

    table.ledger-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #cbd5e1;
      margin-bottom: 8px;
    }

    table.ledger-table th {
      background-color: #f1f5f9;
      color: #334155;
      font-size: 7.5px;
      font-weight: bold;
      padding: 4px 6px;
      border: 1px solid #cbd5e1;
      text-align: left;
    }

    table.ledger-table td {
      padding: 3.5px 6px;
      font-size: 7.5px;
      border: 1px solid #e2e8f0;
    }

    tr.row-alt {
      background-color: #f8fafc;
    }

    td.num {
      text-align: right;
      font-family: 'Courier New', Courier, monospace;
      font-weight: bold;
    }

    td.code-badge {
      font-weight: bold;
      font-family: 'Courier New', Courier, monospace;
    }

    tr.subtotal-row {
      background-color: #e2e8f0;
      font-weight: bold;
    }

    tr.subtotal-row td {
      border-top: 1.5px solid #64748b;
      border-bottom: 1.5px solid #64748b;
    }

    .balance-badge-ok {
      background-color: #dcfce7;
      color: #15803d;
      font-size: 7px;
      font-weight: bold;
      padding: 1px 4px;
      display: inline-block;
    }
  </style>
</head>
<body>

  <!-- En-tête Général -->
  <div class="header-card">
    <div class="main-title">
      GRAND LIVRE COMPTABLE ANNUEL • EXERCICE 2026
      <span class="badge-stress">STRESS-TEST VOLUMIQUE (500+ ÉCRITURES)</span>
    </div>
    <div class="sub-meta">
      <b>Société :</b> NEXUS GROUP HOLDING SAS &nbsp;|&nbsp; <b>SIRET :</b> 812 490 128 00034 &nbsp;|&nbsp; <b>Code NAF :</b> 6202A &nbsp;|&nbsp; <b>Devise :</b> EUR (€)<br>
      <b>Période d'audit :</b> Du 01/01/2026 au 31/12/2026 &nbsp;|&nbsp; <b>Date d'arrêté des comptes :</b> 07/09/2026 &nbsp;|&nbsp; <b>Normes :</b> PCG & IFRS
    </div>
  </div>

  <!-- Résumé KPIs Exercice -->
  <table class="summary-grid">
    <tr>
      <td style="width: 25%;">
        <div class="kpi-title">Total Débit Cumulé</div>
        <div class="kpi-val" style="color: #0369a1;">14 892 450,80 €</div>
      </td>
      <td style="width: 25%;">
        <div class="kpi-title">Total Crédit Cumulé</div>
        <div class="kpi-val" style="color: #16a34a;">14 892 450,80 €</div>
      </td>
      <td style="width: 25%;">
        <div class="kpi-title">Solde Net de l'Exercice</div>
        <div class="kpi-val" style="color: #0f172a;">0,00 € (Équilibré)</div>
      </td>
      <td style="width: 25%;">
        <div class="kpi-title">Statut d'Audit Légal</div>
        <div class="kpi-val" style="color: #16a34a;">CERTIFIÉ SANS RÉSERVE</div>
      </td>
    </tr>
  </table>
`;

  let totalGeneralDebit = 0;
  let totalGeneralCredit = 0;
  let entryGlobalId = 1000;

  // Generate 12 monthly periods, each with ~35-45 dense entries
  for (const m of months) {
    html += `\n  <div class="month-header">PÉRIODE MENSUELLE : ${m.name.toUpperCase()} (JOURNAUX CENTRALISÉS)</div>`;
    html += `\n  <table class="ledger-table">
    <thead>
      <tr>
        <th style="width: 65px;">N° Écriture</th>
        <th style="width: 55px;">Date</th>
        <th style="width: 35px;">Jrn</th>
        <th style="width: 55px;">Compte</th>
        <th>Libellé de l'Opération Comptable / Tiers</th>
        <th style="width: 75px; text-align: right;">Débit (€)</th>
        <th style="width: 75px; text-align: right;">Crédit (€)</th>
        <th style="width: 45px; text-align: center;">Statut</th>
      </tr>
    </thead>
    <tbody>`;

    let monthDebit = 0;
    let monthCredit = 0;

    // Generate ~36 entries per month
    for (let e = 1; e <= 36; e++) {
      entryGlobalId++;
      const day = String(Math.min(28, Math.floor((e * 28) / 36) + 1)).padStart(2, '0');
      const dateStr = `${day}/${m.num}/2026`;
      const jrn = journals[(e - 1) % journals.length];
      const isAlt = e % 2 === 0;

      let account = '401000';
      let label = '';
      let debit = 0;
      let credit = 0;

      switch (jrn.code) {
        case 'ACH': {
          const supp = suppliers[(e + parseInt(m.num, 10)) % suppliers.length];
          const basePrice = 1200 + ((e * 370 + parseInt(m.num, 10) * 85) % 8500);
          account = (e % 2 === 0) ? '606400' : '611000';
          label = `Fact. Fournisseur ${supp} - Services & Licences IT`;
          debit = basePrice;
          break;
        }
        case 'VTE': {
          const cli = clients[(e + parseInt(m.num, 10)) % clients.length];
          const revenue = 8500 + ((e * 820 + parseInt(m.num, 10) * 210) % 24000);
          account = '706000';
          label = `Fact. Client ${cli} - Prestations d'Ingénierie Cloud`;
          credit = revenue;
          break;
        }
        case 'BNQ': {
          const flow = 3200 + ((e * 490) % 15000);
          if (e % 2 === 0) {
            account = '512000';
            label = `Encaissement Virement Client Grand Compte`;
            debit = flow;
          } else {
            account = '512000';
            label = `Règlement Fournisseur par Prélèvement SEPA`;
            credit = flow;
          }
          break;
        }
        case 'SAL': {
          const salAmount = 4500 + ((e * 150) % 3500);
          account = (e % 2 === 0) ? '641100' : '645100';
          label = (e % 2 === 0) ? `Salaires Bruts Équipe R&D Ingénierie` : `Cotisations Sociales URSSAF & Prévoyance`;
          debit = salAmount;
          break;
        }
        case 'OD': {
          const amort = 1850 + ((e * 95) % 1200);
          account = '681120';
          label = `Dotation Mensuelle Amortissements Infrastructure Clustered`;
          debit = amort;
          break;
        }
      }

      monthDebit += debit;
      monthCredit += credit;

      const debitFormatted = debit > 0 ? debit.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
      const creditFormatted = credit > 0 ? credit.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

      html += `\n      <tr class="${isAlt ? 'row-alt' : ''}">
        <td class="code-badge">#GL-${entryGlobalId}</td>
        <td>${dateStr}</td>
        <td><b style="color: ${jrn.color};">${jrn.code}</b></td>
        <td class="code-badge">${account}</td>
        <td>${label}</td>
        <td class="num">${debitFormatted}</td>
        <td class="num">${creditFormatted}</td>
        <td style="text-align: center;"><span class="balance-badge-ok">LETTRÉ</span></td>
      </tr>`;
    }

    // Balancing counter-entry at month end to keep ledger mathematically clean
    const balanceDiff = monthDebit - monthCredit;
    entryGlobalId++;
    if (balanceDiff > 0) {
      monthCredit += balanceDiff;
      html += `\n      <tr style="background-color: #fefce8;">
        <td class="code-badge">#GL-${entryGlobalId}</td>
        <td>28/${m.num}/2026</td>
        <td><b>BNQ</b></td>
        <td class="code-badge">512000</td>
        <td><b>Contrepartie de Trésorerie d'Équilibrage Mensuel</b></td>
        <td class="num">-</td>
        <td class="num">${balanceDiff.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="text-align: center;"><span class="balance-badge-ok">ÉQUILIBRÉ</span></td>
      </tr>`;
    } else if (balanceDiff < 0) {
      const positiveDiff = Math.abs(balanceDiff);
      monthDebit += positiveDiff;
      html += `\n      <tr style="background-color: #fefce8;">
        <td class="code-badge">#GL-${entryGlobalId}</td>
        <td>28/${m.num}/2026</td>
        <td><b>BNQ</b></td>
        <td class="code-badge">512000</td>
        <td><b>Contrepartie d'Encaissements de Ventes Mensuelles</b></td>
        <td class="num">${positiveDiff.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="num">-</td>
        <td style="text-align: center;"><span class="balance-badge-ok">ÉQUILIBRÉ</span></td>
      </tr>`;
    }

    totalGeneralDebit += monthDebit;
    totalGeneralCredit += monthCredit;

    html += `\n      <tr class="subtotal-row">
        <td colspan="5" style="text-align: right; padding-right: 12px;">SOUS-TOTAL CENTRALISÉ ${m.name.toUpperCase()} :</td>
        <td class="num" style="color: #0369a1;">${monthDebit.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</td>
        <td class="num" style="color: #16a34a;">${monthCredit.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</td>
        <td style="text-align: center;"><span class="balance-badge-ok">VALIDÉ</span></td>
      </tr>
    </tbody>
  </table>`;
  }

  // Final Summary Table
  html += `\n  <div class="month-header" style="background-color: #1e3a8a; margin-top: 18px;">SYNTHÈSE GÉNÉRALE DE CLÔTURE D'EXERCICE (COMMISSARIAT AUX COMPTES)</div>
  <table class="ledger-table" style="border: 2px solid #1e3a8a;">
    <thead>
      <tr style="background-color: #1e3a8a; color: #ffffff;">
        <th style="color: #ffffff;">Masse Comptable</th>
        <th style="color: #ffffff; text-align: right;">Total Débit (€)</th>
        <th style="color: #ffffff; text-align: right;">Total Crédit (€)</th>
        <th style="color: #ffffff; text-align: right;">Solde Débiteur (€)</th>
        <th style="color: #ffffff; text-align: right;">Solde Créditeur (€)</th>
        <th style="color: #ffffff; text-align: center;">Certification</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><b>Comptes de Classe 1 à 5 (Bilan & Capitaux)</b></td>
        <td class="num">${(totalGeneralDebit * 0.45).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="num">${(totalGeneralCredit * 0.45).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="num">-</td>
        <td class="num">-</td>
        <td style="text-align: center;"><span class="balance-badge-ok">CONFORME</span></td>
      </tr>
      <tr class="row-alt">
        <td><b>Comptes de Classe 6 (Charges d'Exploitation)</b></td>
        <td class="num">${(totalGeneralDebit * 0.55).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="num">-</td>
        <td class="num">${(totalGeneralDebit * 0.55).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="num">-</td>
        <td style="text-align: center;"><span class="balance-badge-ok">CONFORME</span></td>
      </tr>
      <tr>
        <td><b>Comptes de Classe 7 (Produits & Chiffre d'Affaires)</b></td>
        <td class="num">-</td>
        <td class="num">${(totalGeneralCredit * 0.55).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="num">-</td>
        <td class="num">${(totalGeneralCredit * 0.55).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="text-align: center;"><span class="balance-badge-ok">CONFORME</span></td>
      </tr>
      <tr class="subtotal-row" style="background-color: #dbeafe; font-size: 8.5px;">
        <td style="font-weight: bold; color: #1e3a8a;">TOTAL GÉNÉRAL CONSOLIDÉ 2026 :</td>
        <td class="num" style="color: #1e3a8a; font-size: 9px;">${totalGeneralDebit.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</td>
        <td class="num" style="color: #1e3a8a; font-size: 9px;">${totalGeneralCredit.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</td>
        <td class="num">-</td>
        <td class="num">-</td>
        <td style="text-align: center;"><span class="balance-badge-ok" style="font-size: 8px;">PARFAIT</span></td>
      </tr>
    </tbody>
  </table>

  <div style="font-size: 8px; color: #64748b; margin-top: 8px; text-align: center;">
    Fin de l'état financier du Grand Livre Général • Imprimé automatiquement par <b>html-to-pdf-lite-module</b> • Document à conservation légale 10 ans.
  </div>

</body>
</html>`;

  return html;
}

const content = generateHeavyLedger();
const targetPath = resolve(process.cwd(), 'demo/templates/11-heavy-financial-ledger.html');
writeFileSync(targetPath, content, 'utf8');
console.log(`✅ Fichier HTML lourd généré avec succès : ${targetPath} (${(content.length / 1024).toFixed(1)} KB)`);
