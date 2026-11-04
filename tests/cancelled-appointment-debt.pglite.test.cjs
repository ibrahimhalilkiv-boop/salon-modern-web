const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require(process.argv[2]||'@electric-sql/pglite');

(async()=>{
  const db=new PGlite();
  await db.exec(`
    create schema private; create schema auth;
    create role anon; create role authenticated;
    create function private.is_manager() returns boolean language sql as $$select true$$;
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create table public.appointments(id uuid primary key,status text not null);
    create table public.customer_debts(id uuid primary key,appointment_id uuid,
      client_id uuid,client_name text not null,amount numeric not null,
      paid_amount numeric not null default 0,status text not null,
      product_sale_id uuid,paid_at timestamptz,updated_at timestamptz);
    create table public.customer_debt_payments(debt_id uuid,client_id uuid,
      client_name text,amount numeric,paid_at timestamptz,recorded_by uuid);
    create function private.convert_open_debt_delete_to_payment() returns trigger
      language plpgsql as $$begin return old; end$$;
    create trigger customer_debts_convert_delete_to_payment before delete on public.customer_debts
      for each row execute function private.convert_open_debt_delete_to_payment();
  `);
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  await db.exec(`
    insert into appointments values ('${id(1)}','confirmed'),('${id(2)}','confirmed'),('${id(3)}','cancelled'),('${id(4)}','confirmed');
    insert into customer_debts(id,appointment_id,client_name,amount,status)
      values ('${id(11)}','${id(1)}','Unpaid',700,'open'),
             ('${id(12)}','${id(2)}','Partial',600,'open'),
             ('${id(13)}','${id(3)}','Old cancellation',400,'open'),
             ('${id(14)}','${id(4)}','Ordinary delete',300,'open');
    update customer_debts set paid_amount=100 where id='${id(12)}';
    insert into customer_debt_payments(debt_id,client_name,amount) values ('${id(12)}','Partial',100);
  `);
  const migration=fs.readFileSync('supabase/migrations/20261104150533_clear_debt_when_appointment_cancelled.sql','utf8');
  await db.exec(migration);
  const guard=fs.readFileSync('supabase/migrations/20261104152957_block_debt_for_cancelled_appointment.sql','utf8');
  await db.exec(guard);
  await db.exec("update appointments set status='cancelled' where id='"+id(1)+"'");
  let rows=await db.query('select id from customer_debts order by id');
  assert.deepEqual(rows.rows.map(x=>x.id),[id(12),id(14)]);
  assert.equal((await db.query('select count(*) n from customer_debt_payments')).rows[0].n,1);
  await assert.rejects(db.exec("update appointments set status='cancelled' where id='"+id(2)+"'"),/Ödeme geçmişi/);
  assert.equal((await db.query("select status from appointments where id='"+id(2)+"'")).rows[0].status,'confirmed');
  await assert.rejects(db.exec(`insert into customer_debts(id,appointment_id,client_name,amount,status) values ('${id(15)}','${id(1)}','Late debt',700,'open')`),/İptal edilmiş/);
  await db.exec(`insert into customer_debts(id,client_name,amount,status) values ('${id(16)}','Standalone',250,'open')`);
  assert.equal((await db.query(`select count(*) n from customer_debts where id='${id(16)}'`)).rows[0].n,1);
  await db.exec("delete from customer_debts where id='"+id(14)+"'");
  assert.equal((await db.query("select status from customer_debts where id='"+id(14)+"'")).rows[0].status,'paid');
  await db.close();
  console.log('PASS cancellation clears unpaid debt, preserves paid history and ordinary delete behavior');
})().catch(error=>{console.error(error);process.exitCode=1});
