import pandas as pd, numpy as np, re
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
ROOT="/home/claude/texcon"
f=pd.read_pickle(f"{ROOT}/f_flags.pkl"); l=pd.read_csv(f"{ROOT}/lines_final.csv",dtype={'invoice_no':str})
l['inv_date']=pd.to_datetime(l.inv_date)
FUEL={'DIESEL, LOW SULPHUR':'DIESEL','DIESEL, DYED FUEL':'DIESEL ROJO','GASOLINE, UNLEADED':'REGULAR'}
l['fuel_type']=l.item_code.map(FUEL)
f['month']=f.inv_date.dt.strftime('%Y-%m'); l['month']=l.inv_date.dt.strftime('%Y-%m')
f['flags_txt']=f.fflags.map(lambda x: ', '.join(x))

F=Font(name='Arial',size=10); FB=Font(name='Arial',size=10,bold=True); FH=Font(name='Arial',size=10,bold=True,color='FFFFFF')
FT=Font(name='Arial',size=14,bold=True); FN=Font(name='Arial',size=9,italic=True,color='666666')
HFILL=PatternFill('solid',fgColor='1F3A5F'); ALT=PatternFill('solid',fgColor='F3F6FA'); RED=PatternFill('solid',fgColor='FDE2E2'); AMB=PatternFill('solid',fgColor='FFF3CD'); GRN=PatternFill('solid',fgColor='E2F5E9')
thin=Side(style='thin',color='CCCCCC'); B=Border(bottom=thin)
wb=Workbook()

def table(ws, df, r0=1, c0=1, money_cols=(), num_cols=(), pct_cols=(), widths=None, name=None):
    for j,col in enumerate(df.columns):
        c=ws.cell(row=r0,column=c0+j,value=str(col)); c.font=FH; c.fill=HFILL; c.alignment=Alignment(horizontal='center',vertical='center',wrap_text=True)
    for i,row in enumerate(df.itertuples(index=False),1):
        for j,v in enumerate(row):
            if isinstance(v,(np.floating,)): v=float(v)
            if isinstance(v,(np.integer,)): v=int(v)
            if isinstance(v,pd.Timestamp): v=v.to_pydatetime().date()
            if isinstance(v,float) and np.isnan(v): v=None
            if isinstance(v,(list,)): v=', '.join(v)
            c=ws.cell(row=r0+i,column=c0+j,value=v); c.font=F; c.border=B
            col=df.columns[j]
            if col in money_cols: c.number_format='$#,##0.00'
            elif col in num_cols: c.number_format='#,##0.0'
            elif col in pct_cols: c.number_format='0.0%'
            elif isinstance(v,(pd.Timestamp,)) or hasattr(v,'year'): c.number_format='yyyy-mm-dd'
            if i%2==0: c.fill=ALT
    ws.freeze_panes=ws.cell(row=r0+1,column=c0)
    for j,col in enumerate(df.columns):
        w=(widths or {}).get(col) or min(max(len(str(col)), int(df[col].astype(str).str.len().quantile(0.9) if len(df) else 10))+2, 60)
        ws.column_dimensions[get_column_letter(c0+j)].width=w
    ws.auto_filter.ref=f"{get_column_letter(c0)}{r0}:{get_column_letter(c0+len(df.columns)-1)}{r0+len(df)}"
    return r0+len(df)

# ============ DATA SHEETS FIRST (so summary formulas can reference them) ============
inv=f[['invoice_no','inv_date','month','period','po_key','match_status','po_sheet','po_creator','po_project','po_vendor','po_desc','po_plates','gap_days','terms','due_date','ref_no','n_lines','sales_tax','total','customer_balance','flags_txt','folder','file']].copy()
inv.columns=['Invoice','Date','Month','Period','PO','PO Match','PO Sheet','PO Creator','PO Project','PO Vendor (log)','PO Description (log)','PO Plates','Days PO→Inv','Terms','Due','Ref #','Lines','Tax','Total','Vendor Balance','Flags','Folder','File']
wsI=wb.active; wsI.title='Invoices'
table(wsI, inv.sort_values('Date'), money_cols=('Tax','Total','Vendor Balance'), widths={'Flags':60,'PO Description (log)':40})
for row in wsI.iter_rows(min_row=2, max_row=wsI.max_row):
    st=row[5].value
    if st=='UNMATCHED' or st=='VENDOR_MISMATCH': row[5].fill=RED
    elif st!='STRONG': row[5].fill=AMB
    else: row[5].fill=GRN

ln=l.merge(f[['invoice_no','po_key','po_creator','po_project','period']],on='invoice_no',how='left')
ln=ln[['invoice_no','inv_date','month','period','po_key','po_creator','po_project','line_no','item_code','fuel_type','description','qty','price_each','amount','taxable']]
ln.columns=['Invoice','Date','Month','Period','PO','PO Creator','PO Project','#','Item Code','Fuel Type','Description','Qty (gal/ea)','Unit Price','Amount','Taxable']
wsL=wb.create_sheet('Lines'); table(wsL, ln.sort_values(['Date','Invoice','#']), money_cols=('Unit Price','Amount'), num_cols=('Qty (gal/ea)',))
wsL['M1'].number_format='$#,##0.000'

# ============ SUMMARY ============
ws=wb.create_sheet('Summary',0)
ws['A1']='TEXCON (BenQwest LLC) · Forensic Fuel Audit · Jan 2 – Sep 4, 2026'; ws['A1'].font=FT
ws['A2']='Source: 1,013 PDF invoices (6 duplicate files removed → 1,007 unique invoices). Cross-referenced against PO_Number_List.xlsx (9 sheets, 8,377 PO rows). Prepared Sep 13, 2026 for Tito Cueto, Muñiz Concrete & Contracting.'; ws['A2'].font=FN
r=4
def kv(label, formula, fmt='$#,##0.00', note=None):
    global r
    ws.cell(row=r,column=1,value=label).font=FB; c=ws.cell(row=r,column=2,value=formula); c.font=F; c.number_format=fmt; c.alignment=Alignment(horizontal='right')
    if note: ws.cell(row=r,column=3,value=note).font=FN
    r+=1
kv('Invoices (unique)','=COUNTA(Invoices!A:A)-1','#,##0')
kv('Total billed','=SUM(Invoices!S:S)')
kv('  of which sales tax','=SUM(Invoices!R:R)')
kv('Fuel $ (all three products)','=SUMIFS(Lines!N:N,Lines!J:J,"DIESEL")+SUMIFS(Lines!N:N,Lines!J:J,"DIESEL ROJO")+SUMIFS(Lines!N:N,Lines!J:J,"REGULAR")')
kv('Non-fuel $ (DEF, lubes, tools, consumables)','=B5-B6-B7', note='Everything Texcon sells that is not fuel — see Non-Fuel tab')
kv('Gallons · clear diesel','=SUMIFS(Lines!L:L,Lines!J:J,"DIESEL")','#,##0.0')
kv('Gallons · dyed (off-road) diesel','=SUMIFS(Lines!L:L,Lines!J:J,"DIESEL ROJO")','#,##0.0')
kv('Gallons · unleaded','=SUMIFS(Lines!L:L,Lines!J:J,"REGULAR")','#,##0.0')
kv('Avg $/gal clear diesel','=B6/B9*0+SUMIFS(Lines!N:N,Lines!J:J,"DIESEL")/B9','$#,##0.000')
kv('Avg $/gal dyed diesel','=SUMIFS(Lines!N:N,Lines!J:J,"DIESEL ROJO")/B10','$#,##0.000')
kv('Avg $/gal unleaded','=SUMIFS(Lines!N:N,Lines!J:J,"REGULAR")/B11','$#,##0.000')
r+=1
ws.cell(row=r,column=1,value='PO CONTROL · before vs after March 1, 2026 (your control baseline)').font=FB; r+=1
hdr=['Period','Invoices','Billed $','PO strong match','Unmatched (no PO / PO not in log)','Unmatched $','Unmatched %']
for j,h in enumerate(hdr,1):
    c=ws.cell(row=r,column=j,value=h); c.font=FH; c.fill=HFILL; c.alignment=Alignment(wrap_text=True,horizontal='center')
r+=1
for per in ['PRE-MAR1','POST-MAR1']:
    ws.cell(row=r,column=1,value=per).font=FB
    ws.cell(row=r,column=2,value=f'=COUNTIFS(Invoices!D:D,"{per}")').number_format='#,##0'
    ws.cell(row=r,column=3,value=f'=SUMIFS(Invoices!S:S,Invoices!D:D,"{per}")').number_format='$#,##0'
    ws.cell(row=r,column=4,value=f'=COUNTIFS(Invoices!D:D,"{per}",Invoices!F:F,"STRONG")').number_format='#,##0'
    ws.cell(row=r,column=5,value=f'=COUNTIFS(Invoices!D:D,"{per}",Invoices!F:F,"UNMATCHED")').number_format='#,##0'
    ws.cell(row=r,column=6,value=f'=SUMIFS(Invoices!S:S,Invoices!D:D,"{per}",Invoices!F:F,"UNMATCHED")').number_format='$#,##0'
    ws.cell(row=r,column=7,value=f'=E{r}/B{r}').number_format='0.0%'
    for j in range(1,8): ws.cell(row=r,column=j).font=F if j>1 else FB
    r+=1
r+=1
ws.cell(row=r,column=1,value='PO Match legend').font=FB; r+=1
for k,v in [('STRONG','PO found in log, vendor is Texcon, dates within 45 days'),('FUEL_VENDOR_VARIANT','PO found, log vendor is a fuel vendor written differently (Leo\'s, "Fuel", Tex-Con variants)'),('VENDOR_MISMATCH','PO number exists in log but was issued to a different vendor (O\'Reilly, Bobcat, ACE…) — number collision or misquoted PO'),('DATE_MISMATCH','PO number exists but its log date is >45 days from the invoice — likely an older PO number reused by another sheet'),('PO_NO_DATE','PO exists in log with no date'),('UNMATCHED','PO number not in any sheet, or project name given as PO, or no PO at all')]:
    ws.cell(row=r,column=1,value=k).font=FB; ws.cell(row=r,column=2,value=v).font=F; r+=1
ws.column_dimensions['A'].width=46; ws.column_dimensions['B'].width=22; ws.column_dimensions['C'].width=16
for col in 'DEFG': ws.column_dimensions[col].width=16
ws.column_dimensions['B'].width=22

# ============ MONTHLY ============
wsM=wb.create_sheet('Monthly')
months=sorted(f.month.unique())
wsM['A1']='Monthly spend and volume (formulas over Invoices / Lines)'; wsM['A1'].font=FT
hdr=['Month','Invoices','Billed $','Avg invoice $','Gal clear diesel','$ clear diesel','$/gal','Gal dyed diesel','$ dyed','$/gal','Gal unleaded','$ unleaded','$/gal','Non-fuel $','Unmatched POs']
for j,h in enumerate(hdr,1):
    c=wsM.cell(row=3,column=j,value=h); c.font=FH; c.fill=HFILL; c.alignment=Alignment(wrap_text=True,horizontal='center')
for i,m in enumerate(months):
    rr=4+i; wsM.cell(row=rr,column=1,value=m).font=FB
    wsM.cell(row=rr,column=2,value=f'=COUNTIFS(Invoices!C:C,A{rr})').number_format='#,##0'
    wsM.cell(row=rr,column=3,value=f'=SUMIFS(Invoices!S:S,Invoices!C:C,A{rr})').number_format='$#,##0'
    wsM.cell(row=rr,column=4,value=f'=C{rr}/B{rr}').number_format='$#,##0'
    for k,(ft,gc,dc,pc) in enumerate([('DIESEL','E','F','G'),('DIESEL ROJO','H','I','J'),('REGULAR','K','L','M')]):
        wsM[f'{gc}{rr}']=f'=SUMIFS(Lines!L:L,Lines!C:C,A{rr},Lines!J:J,"{ft}")'; wsM[f'{gc}{rr}'].number_format='#,##0'
        wsM[f'{dc}{rr}']=f'=SUMIFS(Lines!N:N,Lines!C:C,A{rr},Lines!J:J,"{ft}")'; wsM[f'{dc}{rr}'].number_format='$#,##0'
        wsM[f'{pc}{rr}']=f'=IFERROR({dc}{rr}/{gc}{rr},0)'; wsM[f'{pc}{rr}'].number_format='$0.000'
    wsM[f'N{rr}']=f'=C{rr}-SUMIFS(Invoices!R:R,Invoices!C:C,A{rr})-F{rr}-I{rr}-L{rr}'; wsM[f'N{rr}'].number_format='$#,##0'
    wsM[f'O{rr}']=f'=COUNTIFS(Invoices!C:C,A{rr},Invoices!F:F,"UNMATCHED")'
    for j in range(2,16): wsM.cell(row=rr,column=j).font=F
rr=4+len(months); wsM.cell(row=rr,column=1,value='TOTAL').font=FB
for col in 'BCEFHIKLNO': wsM[f'{col}{rr}']=f'=SUM({col}4:{col}{rr-1})'; wsM[f'{col}{rr}'].font=FB; wsM[f'{col}{rr}'].number_format=wsM[f'{col}4'].number_format
wsM[f'D{rr}']=f'=C{rr}/B{rr}'; wsM[f'D{rr}'].number_format='$#,##0'
for c_,g,d in [('G','E','F'),('J','H','I'),('M','K','L')]: wsM[f'{c_}{rr}']=f'={d}{rr}/{g}{rr}'; wsM[f'{c_}{rr}'].number_format='$0.000'
for j in range(1,16): wsM.column_dimensions[get_column_letter(j)].width=13
wsM.column_dimensions['A'].width=10; wsM.freeze_panes='B4'
wsM.cell(row=rr+2,column=1,value='Note: March 2026 diesel jumped from ~$3.27 to ~$4.10–5.24/gal within five weeks (see Weekly Price). Verify against OPIS/EIA Gulf Coast rack for the same weeks before the next Texcon conversation — if the market moved less, that gap is margin.').font=FN

# ============ WEEKLY PRICE ============
fuel=l[l.fuel_type.notna()].copy(); fuel['week']=fuel.inv_date.dt.to_period('W').apply(lambda p: p.start_time.date())
wk=fuel.pivot_table(index='week',columns='fuel_type',values=['price_each'],aggfunc=['mean','min','max']).round(3)
wk.columns=[f'{a} {c}'.replace('mean','avg') for a,b,c in wk.columns]; wk=wk.reset_index()
wk=wk[['week']+sorted([c for c in wk.columns if c!='week'], key=lambda s:(s.split(' ',1)[1], s))]
gal=fuel.pivot_table(index='week',columns='fuel_type',values='qty',aggfunc='sum').round(1).reset_index(); gal.columns=['week']+[f'gal {c}' for c in gal.columns[1:]]
wk=wk.merge(gal,on='week'); wk.rename(columns={'week':'Week of (Mon)'},inplace=True)
wsW=wb.create_sheet('Weekly Price'); wsW['A1']='Weekly $/gal paid at Texcon (avg / min / max) and gallons'; wsW['A1'].font=FT
table(wsW, wk, r0=3, money_cols=tuple(c for c in wk.columns if c.startswith(('avg','min','max'))), num_cols=tuple(c for c in wk.columns if c.startswith('gal')))
for row in wsW.iter_rows(min_row=4,max_row=wsW.max_row,min_col=2,max_col=10):
    for c in row: 
        if c.number_format=='$#,##0.00': c.number_format='$0.000'

# ============ FLAGS ============
fl=f.explode('fflags').dropna(subset=['fflags'])
fs=fl.groupby(['fflags','period']).agg(Invoices=('invoice_no','size'),USD=('total','sum')).reset_index().rename(columns={'fflags':'Flag','period':'Period'}).sort_values('USD',ascending=False)
EXPL={'MIXTO_GAS_Y_DIESEL':'Diesel + ≤12 gal unleaded on one ticket = truck + gas can for equipment (your rule). Informational.',
'MIXTO_GAS_>12GAL_Y_DIESEL':'Diesel + MORE than 12 gal unleaded on one ticket — not a gas can. Two vehicles on one PO, or a wrong-fuel vehicle. Review.',
'CARGA_DIESEL_>60GAL':'A single clear-diesel line over 60 gal — exceeds a pickup tank. Transfer tank / fuel trailer / multiple units. Should be its own PIPA/TAMBO PO with gallons declared.',
'PRECIO_>$0.25_SOBRE_MISMO_DIA':'Paid ≥$0.25/gal more than another Muñiz ticket for the same product the same day. Ask Texcon why one account has two prices in one day.',
'PO_SERIE_93XX_NO_REGISTRADA':'Jan–Feb: 58 invoices citing POs 9350–9489 that appear in NO sheet. A whole numbering series was issued verbally and never logged. $15.3k.',
'PO_REUSADO':'Same PO number on more than one Texcon invoice. Blanket use of a single number — the log shows one purchase, the vendor billed several.',
'HERRAMIENTA_EN_PO_DE_COMBUSTIBLE':'Grease guns, pumps, nozzles, filters bought at Texcon on a PO logged as "Fuel". The description does not match the purchase.',
'FACTURA_>7D_DESPUES_DE_PO':'Invoice dated >7 days after the PO — PO number quoted long after issue (stale number reuse).',
'PO_FECHA_NO_CUADRA':'PO number exists in the log but its date is >45 days off — probably an old number from another sheet reused.',
'PO_EMITIDO_A_OTRO_PROVEEDOR':'Log says this PO was issued to O\'Reilly / Bobcat / ACE / Leo\'s etc. — Texcon accepted a number that was never theirs.',
'TERMINOS_NET15':'From 7/22/2026 a subset of POs (Victor Sanchez, J.D. Ortega, J.A. Licea, F. Arellano) switched to Net 15 while the account is Net 60. Paying on the Net 60 cycle = 1.5%/mo service charge exposure.',
'ARTICULO_DE_MOCHILA':'GLOVES bought at Texcon — a tool-bag item that is never authorized for replacement. The red lane blocks it at ACE; Texcon is the bypass.',
'EQUIPO_>$500':'Non-fuel line over $500 — a $2,068 25-GPM transfer pump (PO 13262 "Combustible"), a $581 12V pump (PO 13244 "2 Pivot bushing"), gear lube drums. Capital items on fuel POs.',
'PO_NO_ESTA_EN_LOG':'Numeric PO not found in any sheet.','PO_PROVEEDOR_VARIANTE':'Log vendor is a fuel vendor spelled differently (Leo\'s, "Fuel and Diesel").','PO_ES_NOMBRE_DE_PROYECTO':'"ADA32", "MCNEIL RD", "N LAMAR" given as the PO — a project name, not a number. Texcon accepted it.',
'PO_FECHADO_DESPUES_DE_FACTURA':'PO logged AFTER the fuel was pumped — number assigned retroactively.','SABADO':'Saturday purchase.','PO_SIN_FECHA_EN_LOG':'PO row in log has no date.','SIN_PO':'Invoice carries no PO at all (gas-station pass-through charges).','COMPRA_EN_GASOLINERA':'"Gas & Others (Gas Station)" pass-through — retail gas station charges billed through the Texcon account, no PO, no gallons.'}
fs['What it means']=fs.Flag.map(EXPL)
wsF=wb.create_sheet('Flags'); wsF['A1']='Forensic flags · one invoice can carry several'; wsF['A1'].font=FT
table(wsF, fs, r0=3, money_cols=('USD',), widths={'What it means':110,'Flag':36})
# flagged invoices detail
fd=fl[['fflags','invoice_no','inv_date','period','po_key','match_status','po_creator','po_project','po_vendor','po_desc','total']].rename(columns={'fflags':'Flag','invoice_no':'Invoice','inv_date':'Date','period':'Period','po_key':'PO','match_status':'PO Match','po_creator':'PO Creator','po_project':'PO Project','po_vendor':'PO Vendor (log)','po_desc':'PO Description (log)','total':'Total'})
fd=fd[~fd.Flag.isin(['MIXTO_GAS_Y_DIESEL'])].sort_values(['Flag','Date'])
wsFD=wb.create_sheet('Flagged Invoices'); table(wsFD, fd, money_cols=('Total',), widths={'PO Description (log)':40})

# ============ UNMATCHED ============
um=f[f.match_status=='UNMATCHED'][['invoice_no','inv_date','period','po_key','total','folder']].rename(columns={'invoice_no':'Invoice','inv_date':'Date','period':'Period','po_key':'PO as quoted to Texcon','total':'Total','folder':'Folder'}).sort_values('Date')
um['Pattern']=np.select([um['PO as quoted to Texcon'].isna(), um['PO as quoted to Texcon'].str.fullmatch(r'9[34]\d\d',na=False), um['PO as quoted to Texcon'].str.contains('ADA',na=False), um['PO as quoted to Texcon'].str.contains(r'[A-Z]',na=False)],['NO PO','93xx–94xx series never logged','Project name as PO','Text / other'],'Numeric, not in any sheet')
wsU=wb.create_sheet('Unmatched POs'); wsU['A1']='Invoices whose PO cannot be found in any sheet of PO_Number_List.xlsx'; wsU['A1'].font=FT
table(wsU, um, r0=3, money_cols=('Total',))

# ============ BUYERS ============
fb=f[f.po_creator.notna()].copy(); fb['creator']=fb.po_creator.astype(str).str.strip().str.upper()
g=l.merge(fb[['invoice_no','creator','period']],on='invoice_no')
by=g.groupby(['creator']).apply(lambda d: pd.Series({'Invoices':d.invoice_no.nunique(),'Total $':f.set_index('invoice_no').loc[d.invoice_no.unique(),'total'].sum(),
    'Gal clear diesel':d[d.fuel_type=='DIESEL'].qty.sum(),'Gal dyed diesel':d[d.fuel_type=='DIESEL ROJO'].qty.sum(),'Gal unleaded':d[d.fuel_type=='REGULAR'].qty.sum(),
    'Non-fuel $':d[d.fuel_type.isna()].amount.sum(),'Largest ticket $':f.set_index('invoice_no').loc[d.invoice_no.unique(),'total'].max()})).reset_index().rename(columns={'creator':'PO Creator (from log)'}).sort_values('Total $',ascending=False)
wsB=wb.create_sheet('Buyers'); wsB['A1']='Who is buying at Texcon (PO creator from the log; 100 unmatched invoices have no creator)'; wsB['A1'].font=FT
table(wsB, by, r0=3, money_cols=('Total $','Non-fuel $','Largest ticket $'), num_cols=('Gal clear diesel','Gal dyed diesel','Gal unleaded'))

# ============ NON-FUEL ============
CAT={'PISTOL':'TOOL','GREASE, GUN':'TOOL','NOZZLE':'TOOL','PUMP':'EQUIPMENT','Filter':'TOOL','GREASE COUPLINGS':'TOOL','VENT CAP':'TOOL','GLOVES':'TOOL BAG ⚠','Gloves Ins':'TOOL BAG ⚠','EXHAUST BULK':'DEF','EXHAUST':'DEF','GAS STATION':'GAS STATION'}
nf=l[l.fuel_type.isna()].merge(f[['invoice_no','po_key','po_creator','po_desc']],on='invoice_no',how='left')
nf['Category']=nf.item_code.map(lambda c: CAT.get(c, 'LUBE' if c.startswith(('P66','MEGAPLEX','GADUS','GUARDOL','OIL','LUCAS','LUBE','SHIELD','ANTI','KEROSENE')) else 'CONSUMABLE (also stocked at ACE)'))
nfs=nf.groupby(['Category','item_code','description']).agg(Lines=('amount','size'),Qty=('qty','sum'),USD=('amount','sum'),Min=('price_each','min'),Max=('price_each','max')).reset_index().sort_values('USD',ascending=False).rename(columns={'item_code':'Item Code','description':'Description'})
wsN=wb.create_sheet('Non-Fuel'); wsN['A1']='Everything bought at Texcon that is not fuel — $21.5k. Tools/equipment/tool-bag items should never ride a fuel PO.'; wsN['A1'].font=FT
end=table(wsN, nfs, r0=3, money_cols=('USD','Min','Max'), num_cols=('Qty',))
nfd=nf[['inv_date','invoice_no','po_key','po_creator','po_desc','Category','item_code','description','qty','price_each','amount']].sort_values('amount',ascending=False).rename(columns={'inv_date':'Date','invoice_no':'Invoice','po_key':'PO','po_creator':'PO Creator','po_desc':'PO Description (log)','item_code':'Item Code','description':'Description','qty':'Qty','price_each':'Unit Price','amount':'Amount'})
wsN.cell(row=end+3,column=1,value='Line detail (sorted by $)').font=FB
table(wsN, nfd, r0=end+4, money_cols=('Unit Price','Amount'), num_cols=('Qty',))

# ============ PO REUSE ============
ru=f[f.po_key.notna()].groupby('po_key').agg(Invoices=('invoice_no','size'),USD=('total','sum'),First=('inv_date','min'),Last=('inv_date','max'),Invoice_list=('invoice_no',lambda s: ', '.join(s)),Creator=('po_creator','first'),Description=('po_desc','first')).reset_index()
ru=ru[ru.Invoices>1].sort_values('USD',ascending=False).rename(columns={'po_key':'PO'})
wsR=wb.create_sheet('PO Reuse'); wsR['A1']='One PO number, several Texcon invoices'; wsR['A1'].font=FT
table(wsR, ru, r0=3, money_cols=('USD',), widths={'Invoice_list':40,'Description':40})

# ============ PO LOG (what was cross-referenced) ============
po=pd.read_csv(f"{ROOT}/po_log_all.csv",dtype={'po_key':str})
po=po[['po_key','date','project','creator','vendor','description','plates','driver','sheet']].rename(columns={'po_key':'PO','date':'Date','project':'Project','creator':'Creator','vendor':'Vendor','description':'Description','plates':'Plates/Equip','driver':'Driver','sheet':'Sheet'})
po['Date']=pd.to_datetime(po.Date,errors='coerce')
po['Texcon invoices']=po.PO.map(f.po_key.value_counts()).fillna(0).astype(int)
wsP=wb.create_sheet('PO Log (ref)'); table(wsP, po, widths={'Description':50})

for s in wb.worksheets:
    for row in s.iter_rows(min_row=1,max_row=3):
        for c in row:
            if c.font==Font(): c.font=F
wb.move_sheet('Summary',-(len(wb.sheetnames)-1))
out='/home/claude/out/Texcon_2026_Forensic_Audit.xlsx'; wb.save(out); print('saved',out)
