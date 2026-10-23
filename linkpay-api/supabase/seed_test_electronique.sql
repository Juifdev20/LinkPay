-- =============================================================
--  DONNÉES DE TEST — Shop des appareils électroniques
--  À exécuter dans le SQL Editor de Supabase APRÈS avoir :
--    1. Créé le compte entreprise de test via l'app
--    2. Complété l'onboarding KYB (secteur : électronique)
--    3. Obtenu le merchant_id de la station (voir requête ci-dessous)
--
--  TROUVER LE MERCHANT_ID :
--    SELECT id, name FROM merchants
--    WHERE organization_id = (
--      SELECT id FROM organizations WHERE name ILIKE '%test%'
--    );
--
--  REMPLACER 'MERCHANT_ID_ICI' par l'UUID trouvé ci-dessus.
--  REMPLACER 'USER_ID_ICI' par l'UUID du compte enterprise de test.
--  (SELECT id FROM auth.users WHERE email ILIKE '%test%' LIMIT 1;)
--
--  NETTOYAGE (supprimer toutes les données de test) :
--    DELETE FROM stock_items WHERE merchant_id = 'MERCHANT_ID_ICI';
-- =============================================================

DO $$
DECLARE
  v_merchant UUID := 'MERCHANT_ID_ICI';  -- <-- remplacer
  v_user     UUID := 'USER_ID_ICI';      -- <-- remplacer
BEGIN

-- ─── TÉLÉPHONIE & MOBILITÉ ────────────────────────────────────────────────

INSERT INTO stock_items
  (merchant_id, name, category, item_type, brand, model,
   unit_price_cents, cost_price_cents, currency,
   quantity, low_stock_threshold,
   condition, warranty_months, serial_number,
   attributes, created_by)
VALUES
  -- Samsung Galaxy A54
  (v_merchant, 'Samsung Galaxy A54', 'telephonie_mobilite', 'Smartphone',
   'Samsung', 'Galaxy A54',
   42000000, 35000000, 'CDF',
   5, 2,
   'neuf', 12, 'SN-SAM-A54-001',
   '{"storage_gb": 128, "ram_gb": 6, "color": "Noir", "imei": "359111234567890"}',
   v_user),

  -- iPhone 14 (occasion)
  (v_merchant, 'iPhone 14', 'telephonie_mobilite', 'Smartphone',
   'Apple', 'iPhone 14',
   95000000, 80000000, 'CDF',
   2, 1,
   'occasion', 6, 'SN-APL-IP14-001',
   '{"storage_gb": 128, "ram_gb": 6, "color": "Midnight", "imei": "358999123456789"}',
   v_user),

  -- Tecno Spark 20
  (v_merchant, 'Tecno Spark 20', 'telephonie_mobilite', 'Smartphone',
   'Tecno', 'Spark 20',
   18000000, 14000000, 'CDF',
   8, 3,
   'neuf', 12, 'SN-TEC-SP20-001',
   '{"storage_gb": 128, "ram_gb": 8, "color": "Blanc", "imei": "354444567891234"}',
   v_user),

  -- Tablette Samsung Tab A8
  (v_merchant, 'Samsung Galaxy Tab A8', 'telephonie_mobilite', 'Tablette',
   'Samsung', 'Galaxy Tab A8',
   55000000, 45000000, 'CDF',
   3, 1,
   'neuf', 12, 'SN-SAM-TABA8-001',
   '{"storage_gb": 64, "ram_gb": 4, "color": "Gris", "imei": ""}',
   v_user),

-- ─── ORDINATEURS ──────────────────────────────────────────────────────────

  -- HP 15s laptop
  (v_merchant, 'HP 15s-fq5', 'ordinateurs', 'PC portable',
   'HP', '15s-fq5',
   120000000, 98000000, 'CDF',
   3, 1,
   'neuf', 24, 'SN-HP-15SFQ5-001',
   '{"processor": "Intel Core i5-1235U", "ram_gb": 8, "storage": "512 Go SSD", "gpu": "Intel Iris Xe", "os": "Windows 11"}',
   v_user),

  -- Dell Inspiron 15
  (v_merchant, 'Dell Inspiron 15 3520', 'ordinateurs', 'PC portable',
   'Dell', 'Inspiron 15 3520',
   110000000, 89000000, 'CDF',
   2, 1,
   'neuf', 12, 'SN-DELL-INS15-001',
   '{"processor": "Intel Core i3-1215U", "ram_gb": 8, "storage": "256 Go SSD", "gpu": "Intel UHD", "os": "Windows 11"}',
   v_user),

  -- Ordinateur de bureau (occasion)
  (v_merchant, 'PC de bureau HP Prodesk 400', 'ordinateurs', 'Ordinateur de bureau',
   'HP', 'Prodesk 400 G6',
   65000000, 50000000, 'CDF',
   1, 1,
   'reconditionne', 6, 'SN-HP-PD400-001',
   '{"processor": "Intel Core i5-10500", "ram_gb": 8, "storage": "256 Go SSD", "gpu": "Intel UHD 630", "os": "Windows 10 Pro"}',
   v_user),

-- ─── COMPOSANTS INFORMATIQUES ─────────────────────────────────────────────

  -- RAM DDR4
  (v_merchant, 'RAM DDR4 8Go Kingston', 'composants_informatiques', 'RAM',
   'Kingston', 'ValueRAM 8Go DDR4 3200MHz',
   8500000, 6500000, 'CDF',
   10, 3,
   'neuf', 36, NULL,
   '{"compatibility": "DDR4 SODIMM / DIMM", "capacity": "8 Go"}',
   v_user),

  -- SSD 256Go
  (v_merchant, 'SSD 256Go Samsung 870 EVO', 'composants_informatiques', 'SSD',
   'Samsung', '870 EVO 256Go',
   14000000, 11000000, 'CDF',
   6, 2,
   'neuf', 36, NULL,
   '{"compatibility": "SATA III 2.5\"", "capacity": "256 Go"}',
   v_user),

-- ─── AUDIO & HI-FI ────────────────────────────────────────────────────────

  -- Écouteurs Bluetooth JBL
  (v_merchant, 'Écouteurs JBL Tune 520BT', 'audio_hifi', 'Écouteurs sans fil',
   'JBL', 'Tune 520BT',
   9500000, 7200000, 'CDF',
   7, 2,
   'neuf', 12, NULL,
   '{"connectivity": "Bluetooth 5.3", "color": "Noir", "battery_life_h": 57}',
   v_user),

  -- Casque Sony
  (v_merchant, 'Casque Sony WH-1000XM4', 'audio_hifi', 'Casque audio',
   'Sony', 'WH-1000XM4',
   75000000, 60000000, 'CDF',
   2, 1,
   'neuf', 12, NULL,
   '{"connectivity": "Bluetooth 5.0 / Jack 3.5mm", "color": "Noir", "battery_life_h": 30}',
   v_user),

-- ─── ACCESSOIRES ──────────────────────────────────────────────────────────

  -- Câble USB-C
  (v_merchant, 'Câble USB-C vers USB-C 1m Anker', 'accessoires', 'Câble USB',
   'Anker', 'PowerLine III USB-C 1m',
   2500000, 1800000, 'CDF',
   20, 5,
   'neuf', 12, NULL,
   '{"connector": "USB-C vers USB-C", "length_m": 1, "power_w": 60, "color": "Noir"}',
   v_user),

  -- Chargeur téléphone
  (v_merchant, 'Chargeur rapide 65W USB-C', 'accessoires', 'Chargeur téléphone',
   'Baseus', 'GaN 65W',
   6000000, 4500000, 'CDF',
   15, 4,
   'neuf', 12, NULL,
   '{"connector": "USB-C", "length_m": 0, "power_w": 65, "color": "Blanc"}',
   v_user),

  -- Powerbank
  (v_merchant, 'Powerbank 20000mAh Romoss', 'accessoires', 'Powerbank',
   'Romoss', 'Sense 8+ 20000mAh',
   12000000, 9000000, 'CDF',
   5, 2,
   'neuf', 12, NULL,
   '{"connector": "USB-C + USB-A", "length_m": 0, "power_w": 22, "color": "Noir"}',
   v_user);

RAISE NOTICE '✅ 14 produits de test créés pour le merchant %', v_merchant;

END $$;
