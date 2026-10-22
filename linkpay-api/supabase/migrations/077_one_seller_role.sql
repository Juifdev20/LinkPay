-- 077 — One person sells and takes the money.
--
-- In our shops the seller is also the cashier: there is a single sales role, « Vendeur / caissier » (slug 'caissier',
-- the one the till, the cash register and the Ventes module already accept), in supermarkets and electronics shops
-- alike. The remaining vendeurs become caissiers on the same station; the new role applies at their next sign-in
-- (until then the API still accepts 'vendeur'). Re-runnable.

UPDATE user_roles
   SET role_id = (SELECT id FROM roles WHERE slug = 'caissier')
 WHERE role_id = (SELECT id FROM roles WHERE slug = 'vendeur')
   AND organization_id IS NOT NULL;

UPDATE roles SET name = 'Vendeur / caissier', description = 'Vend, encaisse et imprime le ticket d''une entreprise'
 WHERE slug = 'caissier';
