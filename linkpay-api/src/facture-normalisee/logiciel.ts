/**
 * Identité du logiciel telle que la DGI la voit : nom du SFE et version soumise à l'homologation. À faire évoluer à chaque
 * livraison (et à communiquer à la DGI, qui demande d'être informée de toute nouvelle version). L'ISF, lui, vient de la
 * configuration du serveur (EMCF_ISF) : voir FactureNormaliseeService.isfAffiche.
 */
export const LOGICIEL = { nom: 'ScanLinkPay', module: 'Facture normalisée (e-MCF)', version: '0.1.0' } as const;
