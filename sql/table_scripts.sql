-- 1. Create PARTY (Strong Entity)
CREATE TABLE PARTY (
    party_id VARCHAR(50) PRIMARY KEY,
    party_name VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    party_type VARCHAR(50)
);

-- 2. Create INVOICE (Weak Entity dependent on PARTY)
CREATE TABLE INVOICE (
    invoice_no VARCHAR(50),
    party_id VARCHAR(50),
    invoice_amount DECIMAL(12, 2) NOT NULL,
    due_date DATE,
    PRIMARY KEY (invoice_no, party_id),
    CONSTRAINT fk_invoice_party FOREIGN KEY (party_id) 
        REFERENCES PARTY(party_id) 
        ON DELETE CASCADE
);

-- 3. Create INVOICE_LINE_ITEMS (Multivalued Attribute Table for INVOICE)
CREATE TABLE INVOICE_LINE_ITEMS (
    invoice_no VARCHAR(50),
    party_id VARCHAR(50),
    line_item VARCHAR(255) NOT NULL,
    PRIMARY KEY (invoice_no, party_id, line_item),
    CONSTRAINT fk_line_items_invoice FOREIGN KEY (invoice_no, party_id) 
        REFERENCES INVOICE(invoice_no, party_id) 
        ON DELETE CASCADE
);

-- 4. Create USERS (Strong Entity)
CREATE TABLE USERS (
    user_id VARCHAR(50) PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,  
    last_name VARCHAR(50) NOT NULL,   
    email VARCHAR(100) NOT NULL
);

-- 5. Create USER_ROLES (Multivalued Attribute Table for USERS)
CREATE TABLE USER_ROLES (
    user_id VARCHAR(50),
    role VARCHAR(50),
    PRIMARY KEY (user_id, role),
    CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) 
        REFERENCES USERS(user_id) 
        ON DELETE CASCADE
);

-- 6. Create BANK_STATEMENT (Strong Entity)
CREATE TABLE BANK_STATEMENT (
    statement_id VARCHAR(50) PRIMARY KEY,
    txn_date DATE NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    reference_no VARCHAR(100),
    status VARCHAR(50)
);

-- 7. Create RECONCILIATION (Strong Entity mapping relationships)
CREATE TABLE RECONCILIATION (
    reconciliation_id VARCHAR(50) PRIMARY KEY,
    match_date DATE NOT NULL,
    match_status VARCHAR(50) NOT NULL,
    variance_amt DECIMAL(12, 2) DEFAULT 0.00, 
    user_id VARCHAR(50) NOT NULL,
    statement_id VARCHAR(50) NOT NULL,
    invoice_no VARCHAR(50) NOT NULL,
    party_id VARCHAR(50) NOT NULL,
    
    -- Foreign Key constraints with RESTRICT rules to preserve auditing/reconciliation logs
    CONSTRAINT fk_recon_user FOREIGN KEY (user_id) 
        REFERENCES USERS(user_id) 
        ON DELETE RESTRICT,
    CONSTRAINT fk_recon_stmt FOREIGN KEY (statement_id) 
        REFERENCES BANK_STATEMENT(statement_id) 
        ON DELETE RESTRICT,
    CONSTRAINT fk_recon_invoice FOREIGN KEY (invoice_no, party_id) 
        REFERENCES INVOICE(invoice_no, party_id) 
        ON DELETE RESTRICT
);

-- 8. Create DISCREPANCY (Weak Entity dependent on RECONCILIATION)
CREATE TABLE DISCREPANCY (
    discrepancy_type VARCHAR(50),
    reconciliation_id VARCHAR(50),
    amount_diff DECIMAL(12, 2) NOT NULL,
    resolution_status VARCHAR(50) NOT NULL,
    PRIMARY KEY (discrepancy_type, reconciliation_id),
    CONSTRAINT fk_discrepancy_recon FOREIGN KEY (reconciliation_id) 
        REFERENCES RECONCILIATION(reconciliation_id) 
        ON DELETE CASCADE
);

