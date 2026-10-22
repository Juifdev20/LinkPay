-- 076 — One sector for supermarkets and food shops.
--
-- "Alimentation" was a third sector next to "Supermarché" and "Électronique": food shops then sold through the Ventes
-- module, without the till. A food shop works like a supermarket (same till, same thermal ticket, same aisles), so the
-- two become one: 'supermarche'. Electronics stays apart (IMEI, serial number, warranty).
-- A supermarket has no "vendeur" (the cashier sells and takes the money): the vendeurs of these businesses become
-- caissiers, on the same station. Their new role applies at their next sign-in. Re-runnable.

UPDATE user_roles ur
   SET role_id = (SELECT id FROM roles WHERE slug = 'caissier')
 WHERE ur.role_id = (SELECT id FROM roles WHERE slug = 'vendeur')
   AND ur.organization_id IN (SELECT id FROM organizations WHERE sector = 'alimentation');

UPDATE organizations SET sector = 'supermarche' WHERE sector = 'alimentation';
