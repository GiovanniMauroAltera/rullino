-- =====================================================================
-- Rullino: il database della macchinetta usa e getta
--
-- Come si usa: su Supabase apri "SQL Editor", premi "New query",
-- incolla tutto questo file e premi "Run".
-- Si può rilanciare quante volte vuoi: non cancella feste né foto.
--
-- Come è protetto: le tabelle sono chiuse (nessuno le legge direttamente).
-- Dal sito si può solo chiamare le funzioni qui sotto, che controllano
-- le regole: quanti scatti restano, se le foto sono già sviluppate,
-- se il codice segreto dell'organizzatore è giusto.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Le tabelle
-- ---------------------------------------------------------------------

-- Una riga per ogni festa
create table if not exists feste (
  id text primary key,                          -- codice corto nel link, es. "k7p2qx"
  nome text not null,
  scatti_per_ospite int not null,
  rivela_alle timestamptz not null,             -- quando si sviluppano le foto
  galleria_per_tutti boolean not null default true,
  data_sulle_foto boolean not null default true,
  codice_hash text not null,                    -- il codice segreto, non in chiaro
  creata_il timestamptz not null default now()
);

-- Una riga per ogni invitato che entra con il suo nome
create table if not exists ospiti (
  id uuid primary key default gen_random_uuid(),
  festa_id text not null references feste(id) on delete cascade,
  nome text not null,
  chiave uuid not null default gen_random_uuid(),  -- segreta: resta solo nel suo telefono
  entrato_il timestamptz not null default now()
);

-- Gli scatti in più che l'organizzatore regala a una persona sola.
-- (Aggiunta dopo: "if not exists" la crea anche nei database già fatti.)
alter table ospiti add column if not exists scatti_extra int not null default 0;

-- "Foto subito": ogni foto si vede nella galleria appena scattata e il
-- rullino resta aperto (invece di aspettare l'ora dello sviluppo).
-- (Aggiunta dopo, come scatti_extra.)
alter table feste add column if not exists foto_subito boolean not null default false;

-- Una riga per ogni foto (l'immagine grande e una piccola per la galleria)
create table if not exists foto (
  id uuid primary key,
  festa_id text not null references feste(id) on delete cascade,
  ospite_id uuid not null references ospiti(id) on delete cascade,
  immagine bytea not null,
  miniatura bytea not null,
  scattata_il timestamptz not null default now()
);

create index if not exists foto_per_festa on foto (festa_id, scattata_il);
create index if not exists foto_per_ospite on foto (ospite_id);
create index if not exists ospiti_per_festa on ospiti (festa_id);

-- Tabelle chiuse: dal sito non si leggono e non si scrivono direttamente
alter table feste enable row level security;
alter table ospiti enable row level security;
alter table foto enable row level security;
revoke all on table feste, ospiti, foto from anon, authenticated;


-- ---------------------------------------------------------------------
-- Funzioni di servizio (non si possono chiamare dal sito)
-- ---------------------------------------------------------------------

-- Trasforma il codice segreto in un'impronta, così non si salva in chiaro
create or replace function calcola_hash(p_festa text, p_codice text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(p_festa || ':' || p_codice, 'UTF8')), 'hex');
$$;

-- Dice se il codice segreto dell'organizzatore è quello giusto
create or replace function codice_giusto(p_festa text, p_codice text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  hash_salvato text;
begin
  if p_codice is null or p_codice = '' then
    return false;
  end if;
  select codice_hash into hash_salvato from feste where id = p_festa;
  if hash_salvato is null then
    return false;
  end if;
  return hash_salvato = calcola_hash(p_festa, p_codice);
end;
$$;

-- Trova la festa oppure si ferma con un messaggio chiaro
create or replace function trova_festa(p_festa text)
returns feste
language plpgsql
security definer
set search_path = public
as $$
declare
  f feste;
begin
  select * into f from feste where id = lower(trim(coalesce(p_festa, '')));
  if not found then
    raise exception 'Festa non trovata: controlla il link o il QR code';
  end if;
  return f;
end;
$$;

-- Si ferma se chi chiede non può ancora vedere le foto
create or replace function controlla_permesso_foto(p_festa text, p_codice text)
returns feste
language plpgsql
security definer
set search_path = public
as $$
declare
  f feste;
begin
  f := trova_festa(p_festa);
  -- l'organizzatore con il codice giusto vede sempre tutto
  if codice_giusto(f.id, p_codice) then
    return f;
  end if;
  -- con "foto subito" le foto si vedono appena scattate, senza aspettare
  if not f.foto_subito and now() < f.rivela_alle then
    raise exception 'Le foto non sono ancora state sviluppate';
  end if;
  if not f.galleria_per_tutti then
    raise exception 'Queste foto le vede solo chi ha organizzato la festa';
  end if;
  return f;
end;
$$;

-- Toglie gli "a capo" che Postgres mette dentro il base64
create or replace function in_base64(p_dati bytea)
returns text
language sql
immutable
set search_path = public
as $$
  select replace(encode(p_dati, 'base64'), E'\n', '');
$$;


-- ---------------------------------------------------------------------
-- Funzioni per l'organizzatore
-- ---------------------------------------------------------------------

-- La versione vecchia di crea_festa (senza "foto subito") va tolta,
-- altrimenti ne resterebbero due con lo stesso nome e il sito non saprebbe quale usare
drop function if exists crea_festa(text, int, timestamptz, boolean, boolean, text);

-- Crea una festa nuova e restituisce il suo codice corto
create or replace function crea_festa(
  p_nome text,
  p_scatti int,
  p_rivela_alle timestamptz,
  p_galleria_per_tutti boolean,
  p_data_sulle_foto boolean,
  p_codice text,
  p_foto_subito boolean default false
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  lettere text := 'abcdefghjkmnpqrstuvwxyz23456789';
  nuovo_id text;
  posizione int;
  tentativo int;
begin
  p_nome := trim(coalesce(p_nome, ''));
  if length(p_nome) = 0 or length(p_nome) > 60 then
    raise exception 'Scrivi il nome della festa (massimo 60 caratteri)';
  end if;
  if p_scatti is null or p_scatti < 1 or p_scatti > 100 then
    raise exception 'Gli scatti a testa devono essere tra 1 e 100';
  end if;
  if p_rivela_alle is null then
    raise exception 'Scegli quando si sviluppano le foto';
  end if;
  if p_codice is null or length(p_codice) < 4 then
    raise exception 'Il codice segreto deve avere almeno 4 caratteri';
  end if;

  -- sceglie 6 lettere a caso, finché trova un codice libero
  for tentativo in 1..50 loop
    nuovo_id := '';
    for posizione in 1..6 loop
      nuovo_id := nuovo_id || substr(lettere, 1 + floor(random() * length(lettere))::int, 1);
    end loop;
    exit when not exists (select 1 from feste where id = nuovo_id);
  end loop;

  insert into feste (id, nome, scatti_per_ospite, rivela_alle, galleria_per_tutti, data_sulle_foto, codice_hash, foto_subito)
  values (nuovo_id, p_nome, p_scatti, p_rivela_alle,
          coalesce(p_galleria_per_tutti, true), coalesce(p_data_sulle_foto, true),
          calcola_hash(nuovo_id, p_codice), coalesce(p_foto_subito, false));

  return json_build_object('festa', nuovo_id);
end;
$$;

-- Tutto quello che serve alla pagina dell'organizzatore
create or replace function pannello_organizzatore(p_festa text, p_codice text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  f feste;
  elenco_ospiti json;
  spazio_usato bigint;
begin
  f := trova_festa(p_festa);
  if not codice_giusto(f.id, p_codice) then
    raise exception 'Codice segreto sbagliato';
  end if;

  -- gli invitati nell'ordine in cui sono entrati (così l'elenco non "salta"
  -- mentre l'organizzatore preme i pulsanti), con gli scatti fatti e regalati
  select coalesce(json_agg(json_build_object('id', riga.id, 'nome', riga.nome,
                                             'scatti', riga.scatti, 'extra', riga.scatti_extra)
                           order by riga.entrato_il), '[]'::json)
  into elenco_ospiti
  from (
    select o.id, o.nome, o.scatti_extra, o.entrato_il, count(ft.id) as scatti
    from ospiti o
    left join foto ft on ft.ospite_id = o.id
    where o.festa_id = f.id
    group by o.id, o.nome, o.scatti_extra, o.entrato_il
  ) as riga;

  select coalesce(sum(length(immagine) + length(miniatura)), 0) into spazio_usato
  from foto where festa_id = f.id;

  return json_build_object(
    'festa', f.id,
    'nome', f.nome,
    'scatti_per_ospite', f.scatti_per_ospite,
    'rivela_alle', f.rivela_alle,
    'rivelata', now() >= f.rivela_alle,
    'galleria_per_tutti', f.galleria_per_tutti,
    'data_sulle_foto', f.data_sulle_foto,
    'foto_subito', f.foto_subito,
    'adesso', now(),
    'numero_foto', (select count(*) from foto where festa_id = f.id),
    'ospiti', elenco_ospiti,
    'spazio_usato', spazio_usato
  );
end;
$$;

-- Anche la versione vecchia di modifica_festa va tolta (vedi crea_festa)
drop function if exists modifica_festa(text, text, boolean, timestamptz, boolean, int);

-- Cambia le regole della festa (i valori lasciati vuoti restano come prima)
create or replace function modifica_festa(
  p_festa text,
  p_codice text,
  p_rivela_adesso boolean default false,
  p_rivela_alle timestamptz default null,
  p_galleria_per_tutti boolean default null,
  p_scatti int default null,
  p_foto_subito boolean default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  f feste;
begin
  f := trova_festa(p_festa);
  if not codice_giusto(f.id, p_codice) then
    raise exception 'Codice segreto sbagliato';
  end if;
  if p_scatti is not null and (p_scatti < 1 or p_scatti > 100) then
    raise exception 'Gli scatti a testa devono essere tra 1 e 100';
  end if;

  if p_rivela_adesso then
    update feste set rivela_alle = now() where id = f.id;
  elsif p_rivela_alle is not null then
    update feste set rivela_alle = p_rivela_alle where id = f.id;
  end if;
  if p_galleria_per_tutti is not null then
    update feste set galleria_per_tutti = p_galleria_per_tutti where id = f.id;
  end if;
  if p_scatti is not null then
    update feste set scatti_per_ospite = p_scatti where id = f.id;
  end if;
  if p_foto_subito is not null then
    update feste set foto_subito = p_foto_subito where id = f.id;
  end if;

  return json_build_object('ok', true);
end;
$$;

-- Regala scatti in più a una persona sola (con un numero negativo li toglie,
-- ma solo quelli regalati prima: gli scatti di base restano sempre)
create or replace function regala_scatti(p_festa text, p_codice text, p_ospite text, p_quanti int)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  f feste;
  nuovi_extra int;
begin
  f := trova_festa(p_festa);
  if not codice_giusto(f.id, p_codice) then
    raise exception 'Codice segreto sbagliato';
  end if;
  if p_quanti is null or p_quanti < -100 or p_quanti > 100 then
    raise exception 'Numero di scatti non valido';
  end if;

  update ospiti
  set scatti_extra = least(greatest(scatti_extra + p_quanti, 0), 200)
  where festa_id = f.id and id::text = p_ospite
  returning scatti_extra into nuovi_extra;

  if nuovi_extra is null then
    raise exception 'Invitato non trovato';
  end if;
  return json_build_object('extra', nuovi_extra, 'totale', f.scatti_per_ospite + nuovi_extra);
end;
$$;

-- Cancella una foto (per esempio una venuta male o fuori luogo)
create or replace function elimina_foto(p_festa text, p_codice text, p_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  f feste;
begin
  f := trova_festa(p_festa);
  if not codice_giusto(f.id, p_codice) then
    raise exception 'Codice segreto sbagliato';
  end if;
  delete from foto where festa_id = f.id and id::text = p_id;
  return json_build_object('ok', true);
end;
$$;


-- ---------------------------------------------------------------------
-- Funzioni per gli invitati
-- ---------------------------------------------------------------------

-- Le informazioni pubbliche della festa (niente foto)
create or replace function info_festa(p_festa text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  f feste;
begin
  f := trova_festa(p_festa);
  return json_build_object(
    'festa', f.id,
    'nome', f.nome,
    'scatti_per_ospite', f.scatti_per_ospite,
    'rivela_alle', f.rivela_alle,
    'rivelata', now() >= f.rivela_alle,
    'galleria_per_tutti', f.galleria_per_tutti,
    'data_sulle_foto', f.data_sulle_foto,
    'foto_subito', f.foto_subito,
    'adesso', now(),
    'numero_ospiti', (select count(*) from ospiti where festa_id = f.id),
    'numero_foto', (select count(*) from foto where festa_id = f.id)
  );
end;
$$;

-- Un invitato entra scrivendo il suo nome e riceve la sua chiave segreta
create or replace function entra_nella_festa(p_festa text, p_nome text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  f feste;
  nuovo ospiti;
begin
  f := trova_festa(p_festa);
  p_nome := trim(coalesce(p_nome, ''));
  if length(p_nome) = 0 or length(p_nome) > 30 then
    raise exception 'Scrivi il tuo nome (massimo 30 caratteri)';
  end if;
  insert into ospiti (festa_id, nome) values (f.id, p_nome) returning * into nuovo;
  return json_build_object('chiave', nuovo.chiave, 'nome', nuovo.nome);
end;
$$;

-- Quanti scatti ha ancora un invitato
create or replace function stato_ospite(p_festa text, p_chiave text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  f feste;
  o ospiti;
  fatte int;
begin
  f := trova_festa(p_festa);
  select * into o from ospiti where festa_id = f.id and chiave::text = p_chiave;
  if not found then
    raise exception 'Ospite non trovato';
  end if;
  select count(*) into fatte from foto where ospite_id = o.id;
  return json_build_object(
    'nome', o.nome,
    'scatti_fatti', fatte,
    'scatti_totali', f.scatti_per_ospite + o.scatti_extra,
    'scatti_rimasti', greatest(f.scatti_per_ospite + o.scatti_extra - fatte, 0)
  );
end;
$$;

-- Salva una foto, se l'invitato ha ancora scatti e il rullino è aperto
create or replace function scatta_foto(
  p_festa text,
  p_chiave text,
  p_id text,
  p_immagine text,
  p_miniatura text,
  p_scattata_il timestamptz default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  f feste;
  o ospiti;
  fatte int;
  limite int;
  id_foto uuid;
  dati bytea;
  piccola bytea;
begin
  f := trova_festa(p_festa);

  -- "for update" mette in fila due foto mandate insieme dallo stesso telefono
  select * into o from ospiti where festa_id = f.id and chiave::text = p_chiave for update;
  if not found then
    raise exception 'Ospite non trovato';
  end if;
  -- gli scatti di questa persona: quelli di tutti più quelli regalati a lei
  limite := f.scatti_per_ospite + o.scatti_extra;

  begin
    id_foto := p_id::uuid;
  exception when others then
    raise exception 'Codice della foto non valido';
  end;

  -- Se la foto era già arrivata (il telefono la rimanda dopo un problema
  -- di rete) non la salviamo e non la contiamo una seconda volta
  if exists (select 1 from foto where id = id_foto) then
    select count(*) into fatte from foto where ospite_id = o.id;
    return json_build_object('scatti_rimasti', greatest(limite - fatte, 0), 'gia_ricevuta', true);
  end if;

  -- Dopo lo sviluppo il rullino è chiuso. Lasciamo un'ora di tempo solo
  -- alle foto scattate prima, rimaste nel telefono per mancanza di rete.
  -- Con "foto subito" invece il rullino resta aperto finché ci sono scatti.
  if not f.foto_subito and now() >= f.rivela_alle then
    if p_scattata_il is null or p_scattata_il >= f.rivela_alle or now() > f.rivela_alle + interval '1 hour' then
      raise exception 'Il rullino è chiuso: le foto sono già state sviluppate';
    end if;
  end if;

  select count(*) into fatte from foto where ospite_id = o.id;
  if fatte >= limite then
    raise exception 'Hai finito gli scatti';
  end if;

  begin
    dati := decode(p_immagine, 'base64');
    piccola := decode(p_miniatura, 'base64');
  exception when others then
    raise exception 'La foto non è arrivata intera, riprova';
  end;
  if length(dati) < 1000 or length(piccola) < 100 then
    raise exception 'La foto è vuota';
  end if;
  if length(dati) > 3000000 or length(piccola) > 300000 then
    raise exception 'La foto è troppo grande';
  end if;

  insert into foto (id, festa_id, ospite_id, immagine, miniatura)
  values (id_foto, f.id, o.id, dati, piccola);

  return json_build_object('scatti_rimasti', limite - fatte - 1, 'gia_ricevuta', false);
end;
$$;


-- ---------------------------------------------------------------------
-- Funzioni della galleria (dopo lo sviluppo, o per l'organizzatore)
-- ---------------------------------------------------------------------

-- L'elenco delle foto, senza le immagini
create or replace function elenco_foto(p_festa text, p_codice text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  f feste;
  risultato json;
begin
  f := controlla_permesso_foto(p_festa, p_codice);
  select coalesce(json_agg(json_build_object('id', ft.id, 'nome', o.nome, 'scattata_il', ft.scattata_il)
                           order by ft.scattata_il), '[]'::json)
  into risultato
  from foto ft
  join ospiti o on o.id = ft.ospite_id
  where ft.festa_id = f.id;
  return risultato;
end;
$$;

-- Le immagini piccole, a gruppi (al massimo 60 per volta)
create or replace function miniature(p_festa text, p_ids json, p_codice text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  f feste;
  risultato json;
begin
  f := controlla_permesso_foto(p_festa, p_codice);
  if json_array_length(p_ids) > 60 then
    raise exception 'Troppe foto in una volta';
  end if;
  select coalesce(json_agg(json_build_object('id', ft.id, 'miniatura', in_base64(ft.miniatura))), '[]'::json)
  into risultato
  from foto ft
  where ft.festa_id = f.id
    and ft.id::text in (select json_array_elements_text(p_ids));
  return risultato;
end;
$$;

-- Una foto a grandezza piena
create or replace function foto_intera(p_festa text, p_id text, p_codice text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  f feste;
  risultato json;
begin
  f := controlla_permesso_foto(p_festa, p_codice);
  select json_build_object('id', ft.id, 'nome', o.nome, 'scattata_il', ft.scattata_il,
                           'immagine', in_base64(ft.immagine))
  into risultato
  from foto ft
  join ospiti o on o.id = ft.ospite_id
  where ft.festa_id = f.id and ft.id::text = p_id;
  if risultato is null then
    raise exception 'Foto non trovata';
  end if;
  return risultato;
end;
$$;


-- ---------------------------------------------------------------------
-- Chi può chiamare cosa
-- ---------------------------------------------------------------------

-- Le funzioni di servizio non si chiamano dal sito
revoke execute on function calcola_hash(text, text) from public, anon, authenticated;
revoke execute on function codice_giusto(text, text) from public, anon, authenticated;
revoke execute on function trova_festa(text) from public, anon, authenticated;
revoke execute on function controlla_permesso_foto(text, text) from public, anon, authenticated;
revoke execute on function in_base64(bytea) from public, anon, authenticated;

-- Queste invece sì
grant execute on function crea_festa(text, int, timestamptz, boolean, boolean, text, boolean) to anon, authenticated;
grant execute on function pannello_organizzatore(text, text) to anon, authenticated;
grant execute on function modifica_festa(text, text, boolean, timestamptz, boolean, int, boolean) to anon, authenticated;
grant execute on function regala_scatti(text, text, text, int) to anon, authenticated;
grant execute on function elimina_foto(text, text, text) to anon, authenticated;
grant execute on function info_festa(text) to anon, authenticated;
grant execute on function entra_nella_festa(text, text) to anon, authenticated;
grant execute on function stato_ospite(text, text) to anon, authenticated;
grant execute on function scatta_foto(text, text, text, text, text, timestamptz) to anon, authenticated;
grant execute on function elenco_foto(text, text) to anon, authenticated;
grant execute on function miniature(text, json, text) to anon, authenticated;
grant execute on function foto_intera(text, text, text) to anon, authenticated;

-- Avvisa Supabase che ci sono funzioni nuove
notify pgrst, 'reload schema';
