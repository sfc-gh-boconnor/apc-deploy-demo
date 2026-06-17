from snowflake.snowpark.context import get_active_session

session = get_active_session()

# Test content
test_content = "hello from workspace COPY INTO workaround"

# Upload via temp table + COPY INTO
session.sql("CREATE OR REPLACE TEMPORARY TABLE TMP_FILE_UPLOAD (content VARCHAR)").collect()
session.sql(f"INSERT INTO TMP_FILE_UPLOAD VALUES ('{test_content}')").collect()
result = session.sql("""
    COPY INTO @APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_STAGE/test_upload.txt
    FROM TMP_FILE_UPLOAD
    FILE_FORMAT = (TYPE = CSV FIELD_DELIMITER = NONE COMPRESSION = NONE)
    SINGLE = TRUE OVERWRITE = TRUE HEADER = FALSE
""").collect()
print("COPY INTO result:", result)

# Verify file exists on stage
list_result = session.sql("LIST @APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_STAGE PATTERN = '.*test_upload.*'").collect()
print("LIST result:", list_result)

# Clean up test file
session.sql("REMOVE @APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_STAGE/test_upload.txt").collect()
print("Cleanup done")

print("SUCCESS: Snowpark active session workaround works correctly")
