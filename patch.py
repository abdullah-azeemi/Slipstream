import re

with open('apps/frontend/app/sessions/[key]/telemetry/page.tsx', 'r') as f:
    content = f.read()

# Add the import for SvgSpeedTrace
if "import SvgSpeedTrace" not in content:
    content = content.replace("import QualiSpeedPanel from '@/components/telemetry/QualiSpeedPanel'", "import QualiSpeedPanel from '@/components/telemetry/QualiSpeedPanel'\nimport SvgSpeedTrace from '@/components/telemetry/SvgSpeedTrace'")

# 1st replacement: new layout
old_canvas1 = "{CHARTS.map((chart, index) => <canvas key={chart.field} ref={element => { chartRefs.current[index] = element }} height={isMobile ? (chart.field === 'speed' ? 270 : 160) : chart.field === 'speed' ? 360 : Math.min(chart.height, 220)} style={{ display: activeChannel === chart.field ? 'block' : 'none', width: '100%', cursor: 'crosshair' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />)}"
new_canvas1 = """{CHARTS.map((chart, index) => chart.field === 'speed' ? (
                      <div key={chart.field} style={{ display: activeChannel === chart.field ? 'block' : 'none' }}>
                        <SvgSpeedTrace driverData={driverData} tooltipNx={tooltipNx} onMouseMove={handleMouseMove as any} onMouseLeave={handleMouseLeave} />
                      </div>
                    ) : (
                      <canvas key={chart.field} ref={element => { chartRefs.current[index] = element }} height={isMobile ? 160 : Math.min(chart.height, 220)} style={{ display: activeChannel === chart.field ? 'block' : 'none', width: '100%', cursor: 'crosshair' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
                    ))}"""
content = content.replace(old_canvas1, new_canvas1)

# 2nd replacement: old layout
old_canvas2 = "<canvas ref={el => { chartRefs.current[0] = el }} height={isMobile ? 300 : CHARTS[0].height} style={{ display: 'block', width: '100%', cursor: 'crosshair' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />"
new_canvas2 = "<SvgSpeedTrace driverData={driverData} tooltipNx={tooltipNx} onMouseMove={handleMouseMove as any} onMouseLeave={handleMouseLeave} />"
content = content.replace(old_canvas2, new_canvas2)

with open('apps/frontend/app/sessions/[key]/telemetry/page.tsx', 'w') as f:
    f.write(content)
