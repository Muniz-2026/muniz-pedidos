import pandas as pd, openpyxl, re, numpy as np
ROOT="/home/claude/texcon"
p="/mnt/project/PO_Number_List.xlsx"
wb=openpyxl.load_workbook(p, read_only=True, data_only=True)
frames=[]
def norm(h):
    h=str(h or '').strip().lower()
    if h.startswith('po'): return 'po'
    if h.startswith('date'): return 'date'
    if h.startswith('project'): return 'project'
    if h in('creator','purchaser'): return 'creator'
    if h.startswith('vendor'): return 'vendor'
    if h.startswith('desc'): return 'description'
    if 'plate' in h or 'equipment' in h: return 'plates'
    if h.startswith('driver'): return 'driver'
    return None
for ws in wb.worksheets:
    if ws.title in ('Concrete','Sheet1'): continue
    rows=list(ws.iter_rows(min_row=1,max_row=15,values_only=True))
    hdr_idx=None
    for i,r in enumerate(rows):
        if any(str(c or '').strip().lower().startswith('po') for c in r[:3]):
            hdr_idx=i;break
    if hdr_idx is None: print("no header",ws.title); continue
    hdr=[norm(c) for c in rows[hdr_idx]]
    data=[]
    for r in ws.iter_rows(min_row=hdr_idx+2,values_only=True):
        if r is None or all(c is None for c in r[:8]): continue
        d={}
        for h,v in zip(hdr,r):
            if h: d[h]=v
        d['sheet']=ws.title
        data.append(d)
    df=pd.DataFrame(data); frames.append(df); print(ws.title, len(df))
po=pd.concat(frames, ignore_index=True)
# normalize PO key: strip, drop .0
def pokey(v):
    if v is None or (isinstance(v,float) and np.isnan(v)): return None
    s=str(v).strip()
    if re.fullmatch(r'\d+\.0',s): s=s[:-2]
    return s.upper()
po['po_key']=po['po'].map(pokey)
po['date']=pd.to_datetime(po['date'],errors='coerce')
po=po[po['po_key'].notna()]
po.to_csv(f"{ROOT}/po_log_all.csv",index=False)
print("PO log rows:",len(po), "unique keys:",po['po_key'].nunique())
print("Dup PO keys in log:", (po['po_key'].value_counts()>1).sum())

inv=pd.read_csv(f"{ROOT}/invoices.csv", dtype={'invoice_no':str,'po_raw':str})
inv['inv_date']=pd.to_datetime(inv['inv_date'])
inv['po_key']=inv['po_raw'].map(pokey)
# match
polog=po.copy()
polog['vendor_l']=polog['vendor'].astype(str).str.lower()
m=inv.merge(polog[['po_key','date','project','creator','vendor','description','plates','driver','sheet']],on='po_key',how='left',indicator=True)
m['matched']=m['_merge']=='both'
# For POs matched multiple times keep all but note
print("Invoices:",len(inv))
print("Matched invoices (any):", m.drop_duplicates('invoice_no')['matched'].sum())
uniq=m.groupby('invoice_no').agg(n_matches=('po_key','size'),matched=('matched','max')).reset_index()
print(uniq['n_matches'].value_counts().head())
# vendor consistency of matched POs
def is_texcon(v):
    v=str(v).lower(); return any(k in v for k in ['texcon','benqwest','tex con','texon','texcom'])
m['po_vendor_is_texcon']=m['vendor'].map(is_texcon)
print("Matched but PO vendor not Texcon:", m[m['matched']&~m['po_vendor_is_texcon']].drop_duplicates('invoice_no').shape[0])
print(m[m['matched']&~m['po_vendor_is_texcon']].drop_duplicates('invoice_no')[['invoice_no','inv_date','po_key','vendor','description','total']].head(25).to_string())
# unmatched
um=m[~m['matched']].drop_duplicates('invoice_no')
print("\nUNMATCHED:",len(um), "$",round(um['total'].sum(),2))
print(um[['invoice_no','inv_date','po_key','total','folder']].sort_values('inv_date').to_string())
# date sanity: PO date vs invoice date
m['days_po_to_inv']=(m['inv_date']-m['date']).dt.days
print("\nPO->invoice day gap dist:\n", m[m['matched']]['days_po_to_inv'].describe())
print("PO dated AFTER invoice (>1d):", (m['days_po_to_inv']<-1).sum())
print("Invoice > 30d after PO:", (m['days_po_to_inv']>30).sum())
m.to_csv(f"{ROOT}/matched.csv",index=False)
