import sys

with open('src/pages/RecordSale.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if 'ZONE 2: PRODUCT ENTRY TABLE' in line:
        start_idx = i
        break

for i in range(start_idx, len(lines)):
    if 'ZONE 3: FIXED BOTTOM BAR' in lines[i]:
        end_idx = i - 1
        break

if start_idx == -1 or end_idx == -1:
    print(f'Could not find markers: {start_idx}, {end_idx}')
    sys.exit(1)

new_content = """      {/* ══════ ZONE 4: PRODUCT ENTRY TABLE ══════ */}
      <div className="flex-1 overflow-auto bg-[#f8faf9] p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden min-w-[1000px] max-w-[1600px] mx-auto">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_0.6fr_0.6fr_1fr_1fr_0.7fr_0.8fr_0.7fr_0.6fr_1fr_0.4fr] bg-gray-50 border-b border-gray-100 text-[11px] font-bold text-gray-500 uppercase tracking-wider py-2.5">
            <div className="px-4">Product Name</div>
            <div className="px-2">Qty</div>
            <div className="px-2">Sub Qty</div>
            <div className="px-2">Batch</div>
            <div className="px-2">Expiry</div>
            <div className="px-2">HSN</div>
            <div className="px-2">Rate</div>
            <div className="px-2">Disc%</div>
            <div className="px-2">GST%</div>
            <div className="px-2 text-right">Amount</div>
            <div className="px-2"></div>
          </div>

          {/* Table rows */}
          <div className="divide-y divide-gray-50">
            {rows.map((row, idx) => (
              <div
                key={row.uid}
                data-row-uid={row.uid}
                className={`group transition-colors ${row.productId ? 'bg-white hover:bg-gray-50/50' : 'bg-transparent opacity-50'}`}
              >
                <div className="grid grid-cols-[2fr_0.6fr_0.6fr_1fr_1fr_0.7fr_0.8fr_0.7fr_0.6fr_1fr_0.4fr] items-center py-1.5 focus-within:bg-[#1a7a4a]/[0.02]">
                  {/* Product */}
                  <div className="px-4 relative flex items-center">
                    {row.productId ? (
                      <div className="flex flex-col py-1 overflow-hidden pointer-events-none">
                        <span className="text-sm font-bold text-gray-800 truncate">{row.productName}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] font-bold text-[#1a7a4a] bg-[#1a7a4a]/10 px-1.5 py-0.5 rounded">Stock: {row.stock}</span>
                          <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">Unit: {row.pcsPerUnit}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400 italic py-2 pointer-events-none">
                        Scan or search to add items...
                      </div>
                    )}
                  </div>

                  {/* Qty */}
                  <div className="px-1">
                    <Input
                      ref={el => setFieldRef(row.uid, 'qty', el)}
                      type="number"
                      min="0"
                      max={row.stock || 99999}
                      value={row.qty}
                      onChange={e => updateRow(idx, { qty: parseInt(e.target.value) || 0 })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'qty')}
                      disabled={!row.productId}
                      className="h-9 text-sm px-2 text-center font-bold bg-transparent border-transparent hover:border-gray-200 focus:border-[#1a7a4a] focus:ring-1 focus:ring-[#1a7a4a]/20 focus:bg-white disabled:opacity-50 transition-colors shadow-none"
                    />
                  </div>

                  {/* Sub Qty */}
                  <div className="px-1">
                    <Input
                      ref={el => setFieldRef(row.uid, 'subQty', el)}
                      type="number"
                      min="0"
                      value={row.subQty}
                      onChange={e => updateRow(idx, { subQty: e.target.value === '' ? '' : parseInt(e.target.value) || 0 })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'subQty')}
                      disabled={!row.productId}
                      placeholder="—"
                      className="h-9 text-sm px-2 text-center font-bold bg-transparent border-transparent hover:border-gray-200 focus:border-[#1a7a4a] focus:ring-1 focus:ring-[#1a7a4a]/20 focus:bg-white disabled:opacity-50 transition-colors shadow-none text-blue-700"
                    />
                  </div>

                  {/* Batch */}
                  <div className="px-1">
                    <Input
                      ref={el => setFieldRef(row.uid, 'batch', el)}
                      value={row.batch}
                      onChange={e => updateRow(idx, { batch: e.target.value })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'batch')}
                      disabled={!row.productId}
                      placeholder="—"
                      className="h-9 text-[13px] px-2 font-medium bg-transparent border-transparent hover:border-gray-200 focus:border-[#1a7a4a] focus:ring-1 focus:ring-[#1a7a4a]/20 focus:bg-white disabled:opacity-50 transition-colors shadow-none text-gray-600"
                    />
                  </div>

                  {/* Expiry */}
                  <div className="px-1">
                    <Input
                      ref={el => setFieldRef(row.uid, 'expiry', el)}
                      type="date"
                      value={row.expiry}
                      onChange={e => updateRow(idx, { expiry: e.target.value })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'expiry')}
                      disabled={!row.productId}
                      className="h-9 text-[11px] px-1 font-medium bg-transparent border-transparent hover:border-gray-200 focus:border-[#1a7a4a] focus:ring-1 focus:ring-[#1a7a4a]/20 focus:bg-white disabled:opacity-50 transition-colors shadow-none text-gray-600"
                    />
                  </div>

                  {/* HSN */}
                  <div className="px-1">
                    <Input
                      ref={el => setFieldRef(row.uid, 'hsn', el)}
                      value={row.hsn}
                      onChange={e => updateRow(idx, { hsn: e.target.value })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'hsn')}
                      disabled={!row.productId}
                      placeholder="—"
                      className="h-9 text-[13px] px-2 font-medium bg-transparent border-transparent hover:border-gray-200 focus:border-[#1a7a4a] focus:ring-1 focus:ring-[#1a7a4a]/20 focus:bg-white disabled:opacity-50 transition-colors shadow-none text-gray-600"
                    />
                  </div>

                  {/* Rate */}
                  <div className="px-1">
                    <Input
                      ref={el => setFieldRef(row.uid, 'rate', el)}
                      type="number"
                      step="0.01"
                      value={row.rate || ''}
                      onChange={e => updateRow(idx, { rate: parseFloat(e.target.value) || 0 })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'rate')}
                      disabled={!row.productId}
                      className="h-9 text-sm px-2 font-semibold bg-transparent border-transparent hover:border-gray-200 focus:border-[#1a7a4a] focus:ring-1 focus:ring-[#1a7a4a]/20 focus:bg-white disabled:opacity-50 transition-colors shadow-none text-gray-800"
                    />
                  </div>

                  {/* Disc% */}
                  <div className="px-1">
                    <Input
                      ref={el => setFieldRef(row.uid, 'discount', el)}
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={row.discount || ''}
                      onChange={e => updateRow(idx, { discount: parseFloat(e.target.value) || 0 })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'discount')}
                      disabled={!row.productId}
                      placeholder="0"
                      className="h-9 text-sm px-2 font-semibold bg-transparent border-transparent hover:border-gray-200 focus:border-[#1a7a4a] focus:ring-1 focus:ring-[#1a7a4a]/20 focus:bg-white disabled:opacity-50 transition-colors shadow-none text-red-600"
                    />
                  </div>

                  {/* GST% */}
                  <div className="px-1">
                    <Input
                      ref={el => setFieldRef(row.uid, 'gst', el)}
                      type="number"
                      step="0.01"
                      value={row.gst || ''}
                      onChange={e => updateRow(idx, { gst: parseFloat(e.target.value) || 0 })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'gst')}
                      disabled={!row.productId}
                      className="h-9 text-sm px-2 font-semibold bg-transparent border-transparent hover:border-gray-200 focus:border-[#1a7a4a] focus:ring-1 focus:ring-[#1a7a4a]/20 focus:bg-white disabled:opacity-50 transition-colors shadow-none text-gray-500"
                    />
                  </div>

                  {/* Amount */}
                  <div className="px-2 text-right">
                    <span className={`text-[15px] font-bold ${row.amount > 0 ? 'text-[#1a7a4a]' : 'text-gray-300'}`}>
                      {row.amount > 0 ? row.amount.toFixed(2) : '-'}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="px-1 flex items-center justify-end">
                    {row.productId && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-gray-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => removeRow(idx)}
                        title="Remove row (Alt+Delete)"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
"""
lines[start_idx:end_idx+1] = [new_content + '\n']

with open('src/pages/RecordSale.tsx', 'w', encoding='utf-8') as f:
    f.writelines(lines)
