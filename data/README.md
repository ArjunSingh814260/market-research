Put Accord's one-time master dumps here as JSON (an array of rows):

- Indicesmaster.json   – full index list (INDEX_CODE, EXCHANGE, INDEX_NAME …)
- Comp_Indexpart.json  – full company ↔ index mapping (FINCODE, SYMBOL, INDEX_CODE …)

/api/index-constituents uses them as the base and applies the daily
incremental feed (A/O/D flags) on top. Without them, you only get whatever
the day's incremental feed happens to contain.
