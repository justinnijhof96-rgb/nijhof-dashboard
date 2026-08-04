-- Gepeelde stukken verwijzen naar hun partij-item, zodat ze niet als losse
-- inkoop-transactie meetellen in de dashboard-tellingen (aantal inkopen, gem. inkoopprijs).
alter table public.items add column if not exists partij_parent_id text;
comment on column public.items.partij_parent_id is 'Gezet op gepeelde stukken: verwijst naar het partij-item waaruit dit stuk is gepeeld. Gebruikt om peel-kinderen uit inkoop-tellingen te houden.';
