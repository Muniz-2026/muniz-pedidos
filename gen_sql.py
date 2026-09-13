import pandas as pd, numpy as np, re, json
ROOT="/home/claude/texcon"
f=pd.read_csv(f"{ROOT}/invoices_matched.csv",dtype={'invoice_no':str,'po_key':str,'po_raw':str,'ref_no':str})
l=pd.read_csv(f"{ROOT}/lines_final.csv",dtype={'invoice_no':str,'po_raw':str})
f['inv_date']=pd.to_datetime(f.inv_date); f['due_date']=pd.to_datetime(f.due_date); f['po_date']=pd.to_datetime(f.po_date,errors='coerce')
l['inv_date']=pd.to_datetime(l.inv_date)

def q(v):
    if v is None or (isinstance(v,float) and np.isnan(v)) or (isinstance(v,str) and v.strip()=='') or v is pd.NaT: return 'null'
    if isinstance(v,(bool,np.bool_)): return 'true' if v else 'false'
    if isinstance(v,(int,float,np.integer,np.floating)): return repr(float(v)) if isinstance(v,(float,np.floating)) else str(int(v))
    if isinstance(v,pd.Timestamp): return "'"+v.strftime('%Y-%m-%d')+"'"
    return "'"+str(v).replace("'","''")+"'"

# ---------------- item catalog ----------------
FUEL={'DIESEL, LOW SULPHUR':('FUEL','DIESEL','Diésel claro (carretera)','Clear diesel LSD 500ppm'),
      'DIESEL, DYED FUEL':('FUEL','DIESEL ROJO','Diésel rojo (equipo, sin impuesto)','Dyed off-road diesel'),
      'GASOLINE, UNLEADED':('FUEL','REGULAR','Gasolina regular','Unleaded gasoline')}
TOOL={'PISTOL','GREASE, GUN','NOZZLE','PUMP','Filter','GREASE COUPLINGS','VENT CAP'}
TOOLBAG={'GLOVES','Gloves Ins'}
LUBE={'P66 MUNLIPLEX','P66 MEGAPLEX','P66 GEAR','P66 MEGAFLOW','P66-XD5','P66 MULTIPLEX','MEGAPLEX','P66','GADUS','GUARDOL','OIL, ROTELLA 15W40','LUCAS','LUBE','P66 SHIELD','SHIELD CHOICE','ANTI, 50/50','ANTIFREEZE 50/50','KEROSENE BULK'}
DEF={'EXHAUST BULK','EXHAUST'}
def cat(code):
    if code in FUEL: return 'FUEL'
    if code in DEF: return 'DEF'
    if code in TOOLBAG: return 'TOOLBAG'
    if code in TOOL: return 'TOOL'
    if code in LUBE: return 'LUBE'
    if code=='GAS STATION': return 'GAS_STATION'
    return 'CONSUMABLE'
items=l.groupby('item_code').agg(descr=('description','first'),n=('amount','size'),usd=('amount','sum')).reset_index()

# ---------------- flags per invoice ----------------
reuse=f[f.po_key.notna()].po_key.value_counts(); reuse=set(reuse[reuse>1].index)
lp=l.copy(); lp['day']=lp.inv_date.dt.date
daymin=lp[lp.item_code.isin(FUEL)].groupby(['day','item_code']).price_each.transform('min'); lp['over_min']=lp.price_each-daymin
lines_by_inv=lp.groupby('invoice_no')
def inv_flags(r):
    fl=[]
    s=r.match_status
    pk=r.po_key if isinstance(r.po_key,str) else None
    if pk is None: fl.append('SIN_PO')
    elif s=='UNMATCHED':
        if re.fullmatch(r'9[34]\d\d',pk): fl.append('PO_SERIE_93XX_NO_REGISTRADA')
        elif 'ADA' in pk or re.search(r'[A-Z]{3}',pk): fl.append('PO_ES_NOMBRE_DE_PROYECTO')
        else: fl.append('PO_NO_ESTA_EN_LOG')
    elif s=='VENDOR_MISMATCH': fl.append('PO_EMITIDO_A_OTRO_PROVEEDOR')
    elif s=='DATE_MISMATCH': fl.append('PO_FECHA_NO_CUADRA')
    elif s=='PO_NO_DATE': fl.append('PO_SIN_FECHA_EN_LOG')
    elif s=='FUEL_VENDOR_VARIANT': fl.append('PO_PROVEEDOR_VARIANTE')
    if pk in reuse: fl.append('PO_REUSADO')
    if r.terms=='Net 15': fl.append('TERMINOS_NET15')
    if r.inv_date.dayofweek>=5: fl.append('SABADO')
    if pd.notna(r.gap_days) and r.gap_days>7: fl.append('FACTURA_>7D_DESPUES_DE_PO')
    if pd.notna(r.gap_days) and r.gap_days<-1: fl.append('PO_FECHADO_DESPUES_DE_FACTURA')
    if r.invoice_no in lines_by_inv.groups:
        g=lines_by_inv.get_group(r.invoice_no)
        codes=set(g.item_code)
        if codes & TOOLBAG: fl.append('ARTICULO_DE_MOCHILA')
        if codes & TOOL: fl.append('HERRAMIENTA_EN_PO_DE_COMBUSTIBLE')
        if (g[~g.item_code.isin(FUEL)].amount>500).any(): fl.append('EQUIPO_>$500')
        if ((g.item_code=='DIESEL, LOW SULPHUR')&(g.qty>60)).any(): fl.append('CARGA_DIESEL_>60GAL')
        gas=g[g.item_code=='GASOLINE, UNLEADED']; dsl=g[g.item_code.isin(['DIESEL, LOW SULPHUR','DIESEL, DYED FUEL'])]
        if len(gas) and len(dsl):
            fl.append('MIXTO_GAS_Y_DIESEL' if (gas.qty<=12).all() else 'MIXTO_GAS_>12GAL_Y_DIESEL')
        if (g[g.item_code.isin(FUEL)].over_min>=0.25).any(): fl.append('PRECIO_>$0.25_SOBRE_MISMO_DIA')
        if (g.item_code=='GAS STATION').any(): fl.append('COMPRA_EN_GASOLINERA')
    return fl
f['fflags']=f.apply(inv_flags,axis=1)
f['po_core']=f.po_key.map(lambda v: (re.match(r'^(\d{3,5})(?!\d)',v).group(1) if isinstance(v,str) and re.match(r'^(\d{3,5})(?!\d)',v) else None))

out=[]
A=out.append
A("-- =====================================================================")
A("--  MUÑIZ · FASE 7 · TEXCON (BenQwest LLC, 8600 Menchaca Rd) · enero–septiembre 2026")
A(f"--  {len(f)} facturas · {len(l)} líneas · ${f.total.sum():,.2f} · Rerunnable (borra y recarga TEXCON).")
A("--  Requiere: fase6 (vendor_invoices, vendor_invoice_lines, ledger_invoices), fase4b (station_tickets), po_log, is_office().")
A("-- =====================================================================")
A("""alter table vendor_invoices add column if not exists terms text, add column if not exists due_date date, add column if not exists ref_no text,
  add column if not exists tax numeric, add column if not exists vendor_balance numeric;
alter table vendor_invoice_lines add column if not exists taxable boolean;
create table if not exists texcon_items (code text primary key, category text not null, fuel_type text, label_es text, label_en text, n_lines int, usd numeric);
create table if not exists texcon_po_check (
  invoice text primary key, po text, po_core text, status text not null, po_sheet text, po_date date, po_creator text, po_project text,
  po_vendor text, po_descr text, po_plates text, po_driver text, gap_days int, period text, flags text[] not null default '{}');
delete from vendor_invoice_lines where vendor = 'TEXCON'; delete from vendor_invoices where vendor = 'TEXCON';
delete from station_tickets where station = 'TEXCON' and source like 'Texcon_2026_%'; delete from texcon_po_check; delete from texcon_items;""")
A("-- ---------- catálogo de artículos Texcon ----------")
for _,r in items.iterrows():
    c=cat(r.item_code); ft=FUEL[r.item_code][1] if r.item_code in FUEL else None
    le=FUEL[r.item_code][2] if r.item_code in FUEL else None; en=FUEL[r.item_code][3] if r.item_code in FUEL else r.descr
    A(f"insert into texcon_items values ({q(r.item_code)},{q(c)},{q(ft)},{q(le)},{q(en)},{int(r.n)},{round(r.usd,2)});")
A("-- ---------- facturas ----------")
for _,r in f.iterrows():
    A(f"insert into vendor_invoices (vendor,invoice,inv_date,po,ship1,ship2,job,ordered_by,subtotal,total,kind,file,terms,due_date,ref_no,tax,vendor_balance) values "
      f"('TEXCON',{q(r.invoice_no)},{q(r.inv_date)},{q(r.po_key)},null,null,{q(r.po_project)},{q(r.po_creator)},{q(round(r.total-r.sales_tax,2))},{q(r.total)},'INVOICE',{q(r.folder+'/'+r.file)},{q(r.terms)},{q(r.due_date)},{q(r.ref_no)},{q(r.sales_tax)},{q(r.customer_balance)});")
A("-- ---------- líneas ----------")
for _,r in l.iterrows():
    A(f"insert into vendor_invoice_lines (vendor,invoice,pos,code,descr,qty,price,amount,taxable) values ('TEXCON',{q(r.invoice_no)},{int(r.line_no)},{q(r.item_code)},{q(r.description)},{q(r.qty)},{q(r.price_each)},{q(r.amount)},{q(bool(r.taxable))});")
A("-- ---------- tickets de estación (una fila por línea de combustible) ----------")
fm=f.set_index('invoice_no')
for _,r in l[l.item_code.isin(FUEL)].iterrows():
    i=fm.loc[r.invoice_no]; ft=FUEL[r.item_code][1]
    plate=i.po_plates if isinstance(i.po_plates,str) else None
    plate_n=re.sub(r'[\s\-]','',plate.upper()) if plate else None
    flags=list(i.fflags)
    A(f"insert into station_tickets (station,ticket_date,amount,gallons,fuel_type,job_hand,plate_raw,plate,po_raw,po_found,creator,project,po_vendor,po_date,flags,source) values "
      f"('TEXCON',{q(i.inv_date)},{q(r.amount)},{q(r.qty)},{q(ft)},{q(i.po_project)},{q(plate)},{q(plate_n)},{q(i.po_key)},{q(i.match_status in ('STRONG','FUEL_VENDOR_VARIANT'))},{q(i.po_creator)},{q(i.po_project)},{q(i.po_vendor)},{q(i.po_date)},"
      f"array[{','.join(q(x) for x in flags)}]::text[],{q('Texcon_2026_'+i.folder[:2])}) on conflict do nothing;")
A("-- ---------- verificación PO por factura (forense) ----------")
for _,r in f.iterrows():
    A(f"insert into texcon_po_check values ({q(r.invoice_no)},{q(r.po_key)},{q(r.po_core)},{q(r.match_status)},{q(r.po_sheet)},{q(r.po_date)},{q(r.po_creator)},{q(r.po_project)},{q(r.po_vendor)},{q(r.po_desc)},{q(r.po_plates)},{q(r.po_driver)},{q(int(r.gap_days)) if pd.notna(r.gap_days) else 'null'},{q(r.period)},array[{','.join(q(x) for x in r.fflags)}]::text[]);")

A("""
-- ---------- ledger_invoices ahora reconoce TEXCON (Tex-Con / Texcon / BenQwest) ----------
create or replace view ledger_invoices with (security_invoker = true) as
select v.*, to_char(v.inv_date, 'YYYY-MM') as month,
       (select case when x ~ '^FERN' then 'FERNANDO ARELLANO' when x = 'ALVARO' then 'ALVARO AGUIRRE' when x = 'PEDRO' then 'PEDRO LIMON' when x = 'ISIDRO' then 'ISIDRO SANCHEZ' when x = 'JESUS' then 'GIOVANNI RODRIGUEZ' else x end
          from (select nullif(trim(regexp_replace(upper(coalesce(p.creator, nullif(v.ordered_by,''), (select name from people where name = upper(v.ship2)), '')), '\\s*(PO\\s*#?\\s*\\d+|\\d{3}[- ]?\\d{3}[- ]?\\d{4}|\\d{10})\\s*', '', 'g')),'') x) y) as foreman,
       coalesce(p.project, nullif(v.job,'')) as project,
       p.po_date, p.description as po_descr,
       case when v.po is null or v.po = '' then 'SIN PO'
            when p.po is null then 'PO NO ESTÁ EN EL LOG'
            when p.vendor is not null and not (
                 (v.vendor='ACE' and p.vendor ilike '%ace%') or (v.vendor='CMC' and p.vendor ilike '%cmc%') or (v.vendor='RSS' and (p.vendor ilike '%rss%' or p.vendor ilike '%reinforcing%')) or (v.vendor='WHITECAP' and p.vendor ilike '%white%')
                 or (v.vendor='TEXCON' and (p.vendor ilike '%tex%con%' or p.vendor ilike '%texcon%' or p.vendor ilike '%benqwest%' or p.vendor ilike '%texon%' or p.vendor ilike '%texcom%' or p.vendor ilike '%txcon%')))
              then 'PO EMITIDO PARA ' || upper(p.vendor)
            else 'OK' end as po_check,
       (select count(*) from vendor_invoice_lines l where l.vendor = v.vendor and l.invoice = v.invoice) as n_lines
  from vendor_invoices v
  left join lateral (select * from po_log pl where pl.po = v.po and pl.po_date >= '2025-12-01' order by pl.po_date desc nulls last limit 1) p on true;

-- ---------- vistas Texcon para el mando ----------
drop view if exists texcon_fuel_monthly, texcon_price_daily, texcon_flags, texcon_flag_summary, texcon_buyers, texcon_po_reuse, texcon_nonfuel cascade;
create or replace view texcon_fuel_monthly with (security_invoker = true) as
select to_char(v.inv_date,'YYYY-MM') as month, i.fuel_type, count(*) as fills, round(sum(l.qty),1) as gallons, round(sum(l.amount),2) as usd,
       round(sum(l.amount)/nullif(sum(l.qty),0),3) as avg_price, min(l.price) as min_price, max(l.price) as max_price
  from vendor_invoice_lines l join vendor_invoices v on v.vendor=l.vendor and v.invoice=l.invoice join texcon_items i on i.code=l.code
 where l.vendor='TEXCON' and i.category='FUEL' group by 1,2;

create or replace view texcon_price_daily with (security_invoker = true) as
select v.inv_date, to_char(v.inv_date,'YYYY-MM') as month, i.fuel_type, count(*) fills, round(sum(l.qty),1) gallons, min(l.price) min_price, max(l.price) max_price, round(max(l.price)-min(l.price),3) spread,
       round(sum((l.price-m.mn)*l.qty),2) as overpaid_vs_day_min
  from vendor_invoice_lines l join vendor_invoices v on v.vendor=l.vendor and v.invoice=l.invoice join texcon_items i on i.code=l.code
  join (select v2.inv_date d, l2.code c, min(l2.price) mn from vendor_invoice_lines l2 join vendor_invoices v2 on v2.vendor=l2.vendor and v2.invoice=l2.invoice where l2.vendor='TEXCON' group by 1,2) m on m.d=v.inv_date and m.c=l.code
 where l.vendor='TEXCON' and i.category='FUEL' group by 1,2,3;

create or replace view texcon_flags with (security_invoker = true) as
select c.invoice, v.inv_date, to_char(v.inv_date,'YYYY-MM') as month, c.po, c.status, c.po_creator, c.po_project, c.po_vendor, c.po_descr, v.total, c.period, f.flag
  from texcon_po_check c join vendor_invoices v on v.vendor='TEXCON' and v.invoice=c.invoice, unnest(c.flags) f(flag);

create or replace view texcon_flag_summary with (security_invoker = true) as
select flag, period, count(*) invoices, round(sum(total),2) usd from texcon_flags group by 1,2 order by 4 desc;

create or replace view texcon_buyers with (security_invoker = true) as
select upper(trim(c.po_creator)) as creator, c.period, count(*) invoices, round(sum(v.total),2) usd,
       round(sum((select sum(l.qty) from vendor_invoice_lines l join texcon_items i on i.code=l.code where l.vendor='TEXCON' and l.invoice=v.invoice and i.fuel_type='DIESEL')),1) gal_diesel,
       round(sum((select sum(l.qty) from vendor_invoice_lines l join texcon_items i on i.code=l.code where l.vendor='TEXCON' and l.invoice=v.invoice and i.fuel_type='DIESEL ROJO')),1) gal_rojo,
       round(sum((select sum(l.qty) from vendor_invoice_lines l join texcon_items i on i.code=l.code where l.vendor='TEXCON' and l.invoice=v.invoice and i.fuel_type='REGULAR')),1) gal_regular
  from texcon_po_check c join vendor_invoices v on v.vendor='TEXCON' and v.invoice=c.invoice
 where c.po_creator is not null group by 1,2;

create or replace view texcon_po_reuse with (security_invoker = true) as
select po, count(*) invoices, round(sum(total),2) usd, min(inv_date) first_use, max(inv_date) last_use, string_agg(invoice, ', ' order by inv_date) invoices_list
  from vendor_invoices where vendor='TEXCON' and po is not null group by po having count(*)>1;

create or replace view texcon_nonfuel with (security_invoker = true) as
select v.inv_date, v.invoice, v.po, c.po_creator, c.po_descr, l.code, i.category, l.descr, l.qty, l.price, l.amount
  from vendor_invoice_lines l join vendor_invoices v on v.vendor=l.vendor and v.invoice=l.invoice join texcon_items i on i.code=l.code
  left join texcon_po_check c on c.invoice=v.invoice
 where l.vendor='TEXCON' and i.category<>'FUEL';

-- ---------- permisos ----------
alter table texcon_items enable row level security; alter table texcon_po_check enable row level security;
drop policy if exists texcon_items_office on texcon_items; create policy texcon_items_office on texcon_items for all using (is_office()) with check (is_office()); grant all on texcon_items to authenticated;
drop policy if exists texcon_po_check_office on texcon_po_check; create policy texcon_po_check_office on texcon_po_check for all using (is_office()) with check (is_office()); grant all on texcon_po_check to authenticated;
grant select on ledger_invoices, texcon_fuel_monthly, texcon_price_daily, texcon_flags, texcon_flag_summary, texcon_buyers, texcon_po_reuse, texcon_nonfuel to authenticated;

select month, fuel_type, fills, gallons, usd, avg_price from texcon_fuel_monthly order by 1 desc, 2 limit 9;""")
sql="\n".join(out)
open(f"{ROOT}/supabase_fase7_texcon.sql","w").write(sql)
print(len(out),"statements", round(len(sql)/1024),"KB")
f.to_pickle(f"{ROOT}/f_flags.pkl")
