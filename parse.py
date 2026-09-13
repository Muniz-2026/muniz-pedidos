import re, os, glob, json, subprocess, sys
import pandas as pd

ROOT = "/home/claude/texcon"
rows_inv, rows_lines, anomalies = [], [], []

money = lambda s: float(s.replace('$','').replace(',','')) if s else None

def parse(path):
    txt = subprocess.run(["pdftotext","-layout",path,"-"],capture_output=True,text=True).stdout
    inv = {"file": os.path.basename(path), "folder": os.path.basename(os.path.dirname(path))}
    # Header: date + invoice #
    m = re.search(r'(\d{1,2}/\d{1,2}/\d{4})\s+(\d{5,7})\s*\n', txt)
    if m: inv["inv_date"], inv["invoice_no"] = m.group(1), m.group(2)
    else: anomalies.append((path,"no header date/inv#"))
    # Vendor block
    inv["vendor_name"] = txt.split('\n')[0].strip().split('  ')[0].strip()
    # Bill To / Ship To block
    bt = re.search(r'Bill To(.*?)P\.O\. Number', txt, re.S)
    if bt:
        blk = bt.group(1)
        lines = [l for l in blk.split('\n') if l.strip()]
        ship = []
        for l in lines:
            # ship-to lives past column ~70
            if len(l) > 70 and l[70:].strip():
                ship.append(l[70:].strip())
        inv["ship_to"] = " | ".join(ship) if ship else None
    # PO / Ref / Terms / Due
    m = re.search(r'P\.O\. Number\s+Ref #\s+Terms\s+Due Date\s*\n\s*\n?\s*(.*)\n', txt)
    if m:
        vals = m.group(1)
        # Tokenize: PO may be missing. Use positional split via multiple spaces
        toks = re.split(r'\s{2,}', vals.strip())
        # Expected order: [PO?] Ref Terms Due
        due = toks[-1] if toks and re.match(r'\d{1,2}/\d{1,2}/\d{4}', toks[-1]) else None
        terms = toks[-2] if len(toks) >= 2 else None
        ref = toks[-3] if len(toks) >= 3 else None
        po = toks[-4] if len(toks) >= 4 else None
        # header-level positions: PO column starts around col 50, ref around 76
        if ref and not re.fullmatch(r'\d{6,8}', str(ref)):
            anomalies.append((path, f"odd ref {ref}"))
        inv["po_raw"] = po
        if not po: anomalies.append((path,"missing PO"))
        inv["ref_no"] = ref
        inv["terms"] = terms
        inv["due_date"] = due
    else:
        anomalies.append((path,"no PO/Ref/Terms line"))
    # Line items: between 'Quantity ... Amount' header and 'A service charge'
    body = re.search(r'Quantity\s+Item Code\s+Description\s+Price Each\s+Amount\s*\n(.*?)A service charge', txt, re.S)
    n_lines = 0; tax = 0.0
    if body:
        for l in body.group(1).split('\n'):
            if not l.strip(): continue
            if 'Sales Tax' in l:
                mt = re.search(r'Sales Tax\s+([\d.]+)%\s+(-?[\d,]+\.\d{2})', l)
                if mt: tax = money(mt.group(2)); inv["tax_rate"] = float(mt.group(1))
                continue
            # qty  itemcode  description  price  amount[T]
            ml = re.match(r'\s*(-?[\d,]*\.?\d+)\s+(.+?)\s{2,}(.+?)\s{2,}(-?[\d,]*\.?\d+)\s+(-?[\d,]+\.\d{2})(T?)\s*$', l)
            if ml:
                qty = float(ml.group(1).replace(',',''))
                code = ml.group(2).strip(); desc = ml.group(3).strip()
                price = float(ml.group(4).replace(',','')); amt = money(ml.group(5))
                rows_lines.append(dict(invoice_no=inv.get("invoice_no"), inv_date=inv.get("inv_date"),
                    po_raw=inv.get("po_raw"), line_no=n_lines+1, qty=qty, item_code=code, description=desc,
                    price_each=price, amount=amt, taxable=(ml.group(6)=='T')))
                n_lines += 1
            elif 'Gas & Others' in l:
                mg = re.search(r'Gas & Others \(Gas Station\)\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})(T?)', l)
                if mg:
                    rows_lines.append(dict(invoice_no=inv.get("invoice_no"), inv_date=inv.get("inv_date"),
                        po_raw=inv.get("po_raw"), line_no=n_lines+1, qty=None, item_code="GAS STATION", description="Gas & Others (Gas Station)",
                        price_each=money(mg.group(1)), amount=money(mg.group(2)), taxable=(mg.group(3)=='T')))
                    n_lines += 1
            else:
                anomalies.append((path, f"unparsed line: {l.strip()[:90]}"))
    else:
        anomalies.append((path,"no line item body"))
    inv["n_lines"] = n_lines; inv["sales_tax"] = tax
    mt = re.search(r'Total\s+\$?(-?[\d,]+\.\d{2})', txt)
    inv["total"] = money(mt.group(1)) if mt else None
    mb = re.search(r'Customer Total Balance\s+\$?(-?[\d,]+\.\d{2})', txt)
    inv["customer_balance"] = money(mb.group(1)) if mb else None
    return inv

files = sorted(glob.glob(f"{ROOT}/*/*.pdf"))
for f in files:
    rows_inv.append(parse(f))

inv = pd.DataFrame(rows_inv); ln = pd.DataFrame(rows_lines)
dups = inv[inv.duplicated("invoice_no", keep=False)][["invoice_no","folder","file"]]
print("DUP FILES:\n", dups.to_string())
inv = inv.drop_duplicates("invoice_no", keep="first")
ln = ln.drop_duplicates()
inv["inv_date"] = pd.to_datetime(inv["inv_date"], errors="coerce")
inv["due_date"] = pd.to_datetime(inv["due_date"], errors="coerce")
ln["inv_date"] = pd.to_datetime(ln["inv_date"], errors="coerce")
inv.to_csv(f"{ROOT}/invoices.csv", index=False); ln.to_csv(f"{ROOT}/lines.csv", index=False)
pd.DataFrame(anomalies, columns=["file","issue"]).to_csv(f"{ROOT}/anomalies.csv", index=False)
print("invoices", len(inv), "lines", len(ln), "anomalies", len(anomalies))
print(inv.head(3).to_string())
print(pd.DataFrame(anomalies).head(30).to_string() if anomalies else "no anomalies")
# reconciliation check: sum(lines)+tax == total
chk = ln.groupby("invoice_no")["amount"].sum().rename("line_sum")
inv2 = inv.merge(chk, on="invoice_no", how="left")
inv2["diff"] = (inv2["line_sum"].fillna(0) + inv2["sales_tax"] - inv2["total"]).round(2)
print("recon mismatches:", (inv2["diff"].abs() > 0.02).sum())
print(inv2[inv2["diff"].abs()>0.02][["file","invoice_no","line_sum","sales_tax","total","diff"]].head(20).to_string())
