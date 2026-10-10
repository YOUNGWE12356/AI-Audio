$ErrorActionPreference = 'Stop'
# English UCS 8.2.1 public-domain list, mirrored with provenance at
# https://github.com/jmrsound/ucs-tools/blob/main/src/ucs_tools/data/PROVENANCE.md
$source = 'https://raw.githubusercontent.com/jmrsound/ucs-tools/main/src/ucs_tools/data/ucs_v8.2.1.csv'
$destination = Join-Path $PSScriptRoot '../src/data/ucs-v8.2.1.json'
$rows = (Invoke-WebRequest -Uri $source -UseBasicParsing).Content | ConvertFrom-Csv
$catalog = @($rows | ForEach-Object {
  [ordered]@{
    catId = $_.CatID
    category = $_.Category
    subcategory = $_.SubCategory
  }
})
if ($catalog.Count -ne 753 -or @($catalog | Where-Object { $_.catId -eq 'WOODHndl' }).Count -ne 1) {
  throw 'UCS 8.2.1 catalog did not pass version checks.'
}
New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
$json = ConvertTo-Json -InputObject $catalog -Depth 3
[System.IO.File]::WriteAllText((Resolve-Path (Split-Path $destination)).Path + '/ucs-v8.2.1.json', $json + "`n", [System.Text.UTF8Encoding]::new($false))
