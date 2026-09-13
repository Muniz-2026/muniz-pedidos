import pandas as pd, numpy as np, re
pd.set_option('display.width',250); pd.set_option('display.max_columns',30)
ROOT="/home/claude/texcon"
inv=pd.read_csv(f"{ROOT}/invoices.csv",dtype={'invoice_no':str,'po_raw':str,'ref_no':str})
ln=pd.read_csv(f"{ROOT}/lines.csv",dtype={'invoice_no':str,'po_raw':str})
po=pd.read_csv(f"{ROOT}/po_log_all.csv",dtype={'po_key':str})
for d in (inv,): d['inv_date']=pd.to_datetime(d['inv_date']); d['due_date']=pd.to_datetime(d['due_date'])
ln['inv_date']=pd.to_datetime(ln['inv_date']); po['date']=pd.to_datetime(po['date'],errors='coerce')

def pokey(v):
    if pd.isna(v): return None
    s=str(v).strip().upper()
    if re.fullmatch(r'\d+\.0',s): s=s[:-2]
    return s
inv['po_key']=inv['po_raw'].map(pokey)
# also a "numeric core" for messy POs like "9351 FARNCO", "8016 HECTOR", "12860-ABEL", "8075.1"
def core(v):
    if v is None or (isinstance(v,float)): return None
    m=re.match(r'^(\d{3,5})(?!\d)',v)
    return m.group(1) if m else None
inv['po_core']=inv['po_key'].map(core)
def is_texcon(v):
    v=str(v).lower(); return any(k in v for k in ['texcon','benqwest','tex-con','tex con','texon','texcom','tecxon'])
po['vendor_texcon']=po['vendor'].map(is_texcon)
po['vendor_fuelish']=po['vendor'].astype(str).str.lower().str.contains('fuel|gas|diesel|leo|texcon|tex-con',regex=True) | po['description'].astype(str).str.lower().str.contains('fuel|gas|diesel|combust|gasolina',regex=True)

# scoring match: candidates by po_key, fallback po_core
recs=[]
for _,r in inv.iterrows():
    cands=po[po['po_key']==r['po_key']]
    how='exact'
    if cands.empty and r['po_core']:
        cands=po[po['po_key']==r['po_core']]; how='core'
    if cands.empty:
        recs.append(dict(invoice_no=r['invoice_no'],match_status='UNMATCHED',match_how=None)); continue
    c=cands.copy()
    c['gap']=(r['inv_date']-c['date']).dt.days
    c['score']=c['vendor_texcon'].astype(int)*4 + c['vendor_fuelish'].astype(int)*2 + ((c['gap'].abs()<=21).astype(int)*3) + ((c['gap']>=-1)&(c['gap']<=45)).astype(int)
    c=c.sort_values('score',ascending=False)
    b=c.iloc[0]
    if b['vendor_texcon'] and abs(b['gap'])<=45: st='STRONG'
    elif b['vendor_fuelish'] and abs(b['gap'])<=45: st='FUEL_VENDOR_VARIANT'
    elif abs(b['gap'])<=45: st='VENDOR_MISMATCH'
    elif pd.isna(b['gap']): st='PO_NO_DATE'
    else: st='DATE_MISMATCH'
    recs.append(dict(invoice_no=r['invoice_no'],match_status=st,match_how=how,po_sheet=b['sheet'],po_date=b['date'],
        po_project=b['project'],po_creator=b['creator'],po_vendor=b['vendor'],po_desc=b['description'],po_plates=b['plates'],po_driver=b['driver'],
        gap_days=b['gap'],n_candidates=len(c)))
mt=pd.DataFrame(recs)
full=inv.merge(mt,on='invoice_no',how='left')
full['period']=np.where(full['inv_date']>='2026-03-01','POST-MAR1','PRE-MAR1')
full.to_csv(f"{ROOT}/invoices_matched.csv",index=False)

print("="*90); print("MATCH STATUS"); print(full.groupby('match_status').agg(n=('invoice_no','size'),usd=('total','sum')).round(2))
print(pd.crosstab(full['period'],full['match_status'],margins=True))
print("\nUnmatched by period $:"); print(full[full.match_status=='UNMATCHED'].groupby('period')['total'].agg(['size','sum']).round(2))
# Unmatched PO key patterns
um=full[full.match_status=='UNMATCHED']
um['pattern']=np.select([um.po_key.isna(), um.po_key.str.fullmatch(r'9[34]\d\d',na=False), um.po_key.str.contains('ADA',na=False), um.po_key.str.contains(r'[A-Z]',na=False)],
                        ['NO PO','93xx-94xx series (unlogged)','Project name as PO (ADA)','Text/other'],'Numeric not in log')
print("\nUnmatched patterns:"); print(um.groupby('pattern').agg(n=('invoice_no','size'),usd=('total','sum')).round(2))
print(um[um.pattern=='Numeric not in log'][['invoice_no','inv_date','po_key','total']].to_string())
print("\nVENDOR MISMATCH sample (PO number collision):"); print(full[full.match_status=='VENDOR_MISMATCH'][['invoice_no','inv_date','po_key','po_sheet','po_vendor','po_desc','gap_days','total']].head(15).to_string())

print("\n"+"="*90); print("SPEND OVERVIEW")
print("Invoices:",len(full),"Total $",round(full.total.sum(),2),"Tax $",round(full.sales_tax.sum(),2))
full['month']=full.inv_date.dt.to_period('M')
mo=full.groupby('month').agg(invoices=('invoice_no','size'),usd=('total','sum'),avg=('total','mean')).round(2); print(mo)
print("By period:"); print(full.groupby('period').agg(invoices=('invoice_no','size'),usd=('total','sum'),avg=('total','mean'),first=('inv_date','min'),last=('inv_date','max')).round(2))

print("\n"+"="*90); print("PRODUCT MIX")
ln['product']=ln['item_code'].str.strip()
pm=ln.groupby('product').agg(lines=('amount','size'),gallons=('qty','sum'),usd=('amount','sum'),avg_price=('price_each','mean'),min_price=('price_each','min'),max_price=('price_each','max')).sort_values('usd',ascending=False).round(3)
print(pm.to_string())
fuel_codes=['DIESEL, LOW SULPHUR','DIESEL, DYED FUEL','GASOLINE, UNLEADED']
fuel=ln[ln['product'].isin(fuel_codes)].copy(); fuel['month']=fuel.inv_date.dt.to_period('M')
print("\nGallons by month & fuel:"); print(fuel.pivot_table(index='month',columns='product',values='qty',aggfunc='sum').round(1))
print("\nAvg $/gal by month & fuel:"); print(fuel.pivot_table(index='month',columns='product',values='price_each',aggfunc='mean').round(3))
print("\nSpend by month & fuel:"); print(fuel.pivot_table(index='month',columns='product',values='amount',aggfunc='sum').round(0))
# price variance same day same product
fuel['day']=fuel.inv_date.dt.date
pv=fuel.groupby(['day','product'])['price_each'].agg(['min','max','size']); pv['spread']=pv['max']-pv['min']
print("\nSame-day price spread >$0.05 (same product):"); print(pv[pv.spread>0.05].sort_values('spread',ascending=False).head(20))
# weekly price series diesel
wk=fuel[fuel['product']=='DIESEL, LOW SULPHUR'].groupby(fuel.inv_date.dt.to_period('W'))['price_each'].agg(['mean','min','max','size']).round(3)
print("\nLSD weekly price:"); print(wk.to_string())
# Non-fuel items
nf=ln[~ln['product'].isin(fuel_codes)]
print("\nNon-fuel items:"); print(nf.groupby('product').agg(n=('amount','size'),qty=('qty','sum'),usd=('amount','sum'),avg_price=('price_each','mean')).sort_values('usd',ascending=False).round(2).to_string())
print("Non-fuel $ total:",round(nf.amount.sum(),2),"| taxable lines:",nf.taxable.sum())

print("\n"+"="*90); print("PO REUSE / DUPLICATES")
reuse=full[full.po_key.notna()].groupby('po_key').agg(n=('invoice_no','size'),usd=('total','sum'),dates=('inv_date',lambda s: ', '.join(sorted(set(s.dt.strftime('%m/%d'))))))
reuse=reuse[reuse.n>1].sort_values('n',ascending=False)
print("PO numbers used on >1 invoice:",len(reuse),"$",round(reuse.usd.sum(),2)); print(reuse.head(40).to_string())
# same PO same day same total => possible double bill
dd=full.groupby(['po_key','inv_date','total']).size(); dd=dd[dd>1]
print("\nSame PO+date+total (possible double billing):"); print(dd)
# same ref#
rr=full.groupby('ref_no').size(); print("Duplicate Ref #:", (rr>1).sum())

print("\n"+"="*90); print("TERMS / AR")
print(full.terms.value_counts())
full['due_gap']=(full.due_date-full.inv_date).dt.days; print("Due-date gap days:",full.due_gap.value_counts().head())
bal=full.sort_values(['inv_date','invoice_no']).groupby('inv_date')['customer_balance'].last()
print("Customer balance trajectory (monthly last):"); print(bal.groupby(bal.index.to_period('M')).last())
print("Max balance:",full.customer_balance.max(),"on",full.loc[full.customer_balance.idxmax(),'inv_date'].date())

print("\n"+"="*90); print("BIGGEST / SMALLEST INVOICES")
print(full.nlargest(15,'total')[['invoice_no','inv_date','po_key','total','po_creator','po_plates','po_desc']].to_string())
print("Invoices under $50:",(full.total<50).sum(), " under $100:",(full.total<100).sum())
big=ln.merge(full[['invoice_no','po_creator','po_plates','po_driver']],on='invoice_no')
print("\nLargest single fuel fills (gal):"); print(big[big['product'].isin(fuel_codes)].nlargest(15,'qty')[['invoice_no','inv_date','product','qty','amount','po_creator','po_plates']].to_string())

print("\n"+"="*90); print("WHO / WHAT (from matched POs)")
print("By PO sheet:"); print(full.groupby('po_sheet').agg(n=('invoice_no','size'),usd=('total','sum')).sort_values('usd',ascending=False).round(2))
def nrm(s): return str(s).strip().title() if pd.notna(s) else None
full['creator_n']=full.po_creator.map(nrm)
print("\nBy creator (top 25):"); print(full.groupby('creator_n').agg(n=('invoice_no','size'),usd=('total','sum')).sort_values('usd',ascending=False).round(2).head(25))
full['plates_n']=full.po_plates.astype(str).str.upper().str.replace(r'[\s\-]','',regex=True).replace({'NAN':None,'NONE':None,'':None})
print("\nBy plate/equipment (top 25):"); print(full.groupby('plates_n').agg(n=('invoice_no','size'),usd=('total','sum')).sort_values('usd',ascending=False).round(2).head(25))
print("Invoices with no plate on PO:", full.plates_n.isna().sum())
# fuel type per plate consistency
fp=big.merge(full[['invoice_no','plates_n']],on='invoice_no')
fp=fp[fp['product'].isin(fuel_codes)&fp.plates_n.notna()]
mix=fp.pivot_table(index='plates_n',columns='product',values='qty',aggfunc='sum').fillna(0)
mix['both_gas_and_diesel']=(mix['GASOLINE, UNLEADED']>0)&((mix['DIESEL, LOW SULPHUR']+mix['DIESEL, DYED FUEL'])>0)
print("\nPlates buying BOTH gasoline and diesel:"); print(mix[mix.both_gas_and_diesel].round(1).to_string())
# project
full['project_n']=full.po_project.astype(str).str.strip().str.upper().replace({'NAN':None})
print("\nBy project (top 20):"); print(full.groupby('project_n').agg(n=('invoice_no','size'),usd=('total','sum')).sort_values('usd',ascending=False).round(2).head(20))
# weekday / frequency
print("\nBy weekday:"); print(full.groupby(full.inv_date.dt.day_name()).size())
daily=full.groupby('inv_date').agg(n=('invoice_no','size'),usd=('total','sum')); print("Busiest days:"); print(daily.nlargest(8,'n'))
print("Avg invoices per business day:",round(daily.n.mean(),2))
# dyed diesel share (off-road) and unleaded share
tot=fuel.groupby('product')['qty'].sum(); print("\nGallon share:"); print((tot/tot.sum()*100).round(1))
# description quality on matched POs
full['desc_n']=full.po_desc.astype(str).str.strip().str.lower()
print("\nPO description top values:"); print(full.desc_n.value_counts().head(12))
full.to_csv(f"{ROOT}/invoices_matched.csv",index=False); ln.to_csv(f"{ROOT}/lines_final.csv",index=False)
